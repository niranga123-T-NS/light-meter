# DIMO Lighting Operations System – Implementation Guide

This guide takes the code in `dimo-lighting-ops/` from this repository to a running system:
a **web portal** on Vercel, **Android and iOS apps** built with EAS, and a **Supabase** backend.
It follows the SRS *Lighting Solutions – Sales, Design & Estimation Monitoring System, Draft v0.1 (29 Sep 2026)*.

---

## 1. What you are deploying

```
 Mobile app (iOS / Android)      Web portal (browser)            One Expo Router codebase (src/app)
          │                               │
          └──────────────┬────────────────┘
                         ▼
                 Supabase project
   ┌───────────────────────────────────────────────────────────┐
   │ Auth (email + password, invite only)                      │
   │ Postgres: tables, row-level security, workflow functions │
   │   • SLA engine  – public.sla_tick()       every 15 min    │
   │   • Reminders   – public.reminders_tick() every 15 min    │
   │ Storage: "files" (50 MB, private) · "avatars" (5 MB)      │
   │ Realtime: notifications, inquiries, jobs                  │
   │ Edge Functions: push-dispatch (every minute), admin-users │
   └───────────────────────────────────────────────────────────┘
                         │
                         ▼
          Expo Push service → FCM (Android) / APNs (iOS)
```

* **All business rules live in the database** (`supabase/migrations`). The app calls workflow functions
  such as `submit_inquiry`, `assign_design_job` and `release_quotation`. Each one checks the role and
  the current status, writes the status history, starts and stops SLA clocks, and queues notifications.
  A rule cannot be skipped by using a different screen or the API directly.
* **Visibility (SRS Section 2 and 10.2)** is enforced by row-level security. For example, sales never
  receives design or estimation job rows, cost/margin rows or costing sheets. It is not just hidden in the UI.
* **Notifications are internal only.** They go to the in-app list and to mobile push, with no email or
  WhatsApp. Quiet hours (20:00–07:00, Sundays, holidays) and the daily digest are handled in `app.delivery_time()`.

## 2. Accounts and tools

| Need | Notes |
|---|---|
| Supabase project | **Pro plan recommended** for production (daily backups, no pausing, pg_cron). Pick the **Singapore (ap-southeast-1)** or **Mumbai (ap-south-1)** region – closest to Sri Lanka. |
| GitHub | Hosts the code; CI runs on every push (`.github/workflows/dimo-lighting-ops.yml`). |
| Vercel | Hosts the web portal (static build). |
| Expo account | Free account for EAS Build / Submit / Update. |
| Apple Developer + Google Play Console | Only when you publish the mobile apps to the stores. |
| Node.js 22, Git | Local development. |
| Supabase CLI | `npm i -g supabase` or `brew install supabase/tap/supabase`. |
| EAS CLI | Run as `npx eas-cli@latest <command>`. |

### Optional: give the system its own repository

The new app was built in the `dimo-lighting-ops/` folder of the existing `light-meter` repository, so the
light meter code was left untouched. To move it to its own repository:

```bash
# on your computer, after pulling the branch claude/dimo-lighting-ops
git subtree split --prefix=dimo-lighting-ops -b dimo-only
# create an empty GitHub repo, e.g. dimo-lighting-ops, then:
git push git@github.com:<you>/dimo-lighting-ops.git dimo-only:main
```

Copy `.github/workflows/dimo-lighting-ops.yml` into the new repository and remove the
`working-directory` / `paths` lines, because the app is now at the repository root.

## 3. Set up Supabase

### 3.1 Create and link the project

1. In the Supabase dashboard, create a project (name *dimo-lighting-ops*) and save the **database password**.
2. On your computer:

```bash
cd dimo-lighting-ops
supabase login
supabase link --project-ref <your-project-ref>      # Project Settings → General → Reference ID
supabase db push                                     # applies supabase/migrations/*
supabase db push --include-seed                      # loads supabase/seed.sql (master lists, SLA defaults, settings)
```

The migrations create:

| File | Contents |
|---|---|
| `…01_foundation.sql` | roles, profiles, settings, master lists, brands, competitors, codes (VIS-/INQ-/QTN-YYYY-00001), audit log, attachments, notifications, approvals |
| `…02_calendar_notify.sql` | working-hours calendar (Mon–Fri 08:30–17:30, holidays), quiet hours, notify helpers |
| `…03_customers_projects_visits.sql` | organizations → units → contacts, projects (term, probability bands, duplicates), weekly plans, visits (GPS, offline ids), tenders, account transfer |
| `…04_inquiries_design_estimation.sql` | inquiries, design jobs, estimation jobs, restricted costing, quotations, clarifications |
| `…05_sla_engine.sql` | SLA clocks, colours, escalation ladder L1–L3, 09:00 repeats, customer-deadline alerts |
| `…06_workflow_rpcs.sql` | the full inquiry → design → estimation → client workflow and the approvals engine |
| `…07_plans_debtors_samples.sql` | plan submit/approve/evaluate, plan-vs-actual, debtors upload/ageing/legal, samples |
| `…08_security.sql` | row-level security for every table, file visibility rules, storage buckets and policies, realtime |
| `…09_reminders_dashboards.sql` | scheduled reminders, My Day, Overall Dashboard, KPI scorecard, global search, team performance |
| `…10_scheduler.sql` | pg_cron jobs (SLA tick, reminders, push dispatch) |
| `…11_project_helpers.sql` | project changes with logged reasons, merge, file lists per inquiry, job reassignment, function grants |

### 3.2 Auth settings

Dashboard → **Authentication**:

* **Sign In / Providers → Email**: keep *Email* enabled and **turn off "Allow new users to sign up"**.
  Accounts are created only by the System Administrator.
* **URL Configuration → Site URL**: your Vercel URL, e.g. `https://dimo-lighting-ops.vercel.app`.
  Add `http://localhost:8081` to *Redirect URLs* for local development.
* Optional (SRS 10.3): enable **Multi-Factor Authentication (TOTP)** and set a password policy
  (minimum length, required characters) under *Authentication → Policies / Sign In*.

### 3.3 Edge Functions and secrets

```bash
supabase secrets set DISPATCH_SECRET=$(openssl rand -hex 24) APP_URL=https://<your-vercel-domain>
# optional – only if you enable "enhanced push security" on expo.dev:
# supabase secrets set EXPO_ACCESS_TOKEN=<token from expo.dev → Access tokens>
supabase functions deploy push-dispatch --no-verify-jwt
supabase functions deploy admin-users
```

### 3.4 Let the scheduler call the push dispatcher

pg_cron calls `push-dispatch` every minute. Store two values in **Vault**. In the dashboard, open
**Project Settings → Vault**, or run this in the SQL editor:

```sql
select vault.create_secret('https://<your-project-ref>.supabase.co', 'project_url');
select vault.create_secret('<the same DISPATCH_SECRET value>', 'dispatch_secret');
```

Check that the jobs exist and run:

```sql
select jobname, schedule from cron.job;
select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
```

If `cron.job` is empty (pg_cron was not enabled when the migration ran), enable **pg_cron** and **pg_net**
under *Database → Extensions* and run `supabase/migrations/20260930000010_scheduler.sql` again in the SQL editor.

### 3.5 Create the first administrator

1. Dashboard → **Authentication → Users → Add user → Create new user** (tick *Auto confirm*).
2. In the SQL editor (replace the email):

```sql
insert into public.profiles (id, email, full_name, role)
select id, email, 'System Administrator', 'sys_admin' from auth.users where email = 'it.admin@dimolanka.com';
```

3. Sign in to the web portal as this user. Go to **Settings → Users → Invite user** and add everyone with
   their role and reporting manager. Invites are sent by email, and each person sets their own password.
   Create the GM / DGM first, then the managers, then their teams, so you can pick the *Reports to* person.

> Supabase's built-in email sender is rate-limited. Before inviting the whole division, add your company
> SMTP server under *Authentication → Emails → SMTP Settings*.

### 3.6 Master data to fill in before go-live

Sign in as the System Administrator and complete the **Settings** tabs:

| Tab | What to enter | Why |
|---|---|---|
| Holidays & rates | Every **Sri Lanka public, bank and mercantile holiday** for the year (including Poya days) | Excluded from SLA clocks and quiet-hours logic |
| Holidays & rates | The **monthly USD → LKR rate** | Consolidated LKR totals. Without a rate, 300 is used |
| Brands | Brand master (brand, manufacturer, country, European/Chinese/Other, high/medium/low) | Mandatory brand entry before release, and expectation checks |
| Competitors | Competitor names (SM Projects can add more) | Tender results and lost-to reports |
| Settings | `gm_approval_value_lkr` and `gm_approval_margin_floor_pct` (**placeholders: LKR 50 M and 15%**) | Quotations needing GM / DGM approval (open decision 11.3) |
| Settings | `report_logo_url` – a URL to the DIMO logo | Logo on every PDF report (without it, a text "DIMO" mark is used) |
| SLA rules | Confirm the targets from SRS 8.1 | Seeded with the proposed defaults |
| Master lists | Review categories, objectives (Appendix A), outcomes, reasons | Seeded from the SRS |

## 4. Run it locally

```bash
cd dimo-lighting-ops
cp .env.example .env         # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start               # press w for the web portal, or scan the QR code with a development build
```

The anon key is safe to ship in the app because row-level security protects the data.
**Never put the service-role key in the app or in Vercel.**

Checks (run before every commit; CI runs the same):

```bash
npx tsc --noEmit
npx expo lint
```

To run the database test on a local PostgreSQL (the same test CI runs):

```bash
createdb dimo_test
psql -d dimo_test -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql supabase/seed.sql; do psql -v ON_ERROR_STOP=1 -q -d dimo_test -f "$f"; done
psql -v ON_ERROR_STOP=1 -d dimo_test -f supabase/tests/workflow_test.sql   # ends with "ALL WORKFLOW TESTS PASSED"
```

The test covers Routes A, B and C end to end, the mixed-duty and debtor-check approvals, hold and resume,
client revision R1, row-level security for each role (sales cannot see design/estimation workspaces,
cost, margin or costing sheets), SLA escalation up to GM, the working-hours arithmetic, the debtors upload,
samples, dashboards and search scope.

## 5. Deploy the web portal on Vercel

1. Push the branch to GitHub, and merge it when you are happy with it.
2. In Vercel: **Add New → Project → Import** the GitHub repository.
   * **Root Directory:** `dimo-lighting-ops` (skip this if you moved it to its own repository).
   * The framework preset can stay *Other*. `vercel.json` sets the build (`npx expo export -p web`),
     the output (`dist`) and single-page-app rewrites.
   * **Environment Variables:** `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Production and Preview).
3. Deploy. Then put the production URL in Supabase **Site URL** (3.2) and in the `APP_URL` function secret (3.3).
4. Optional: add a custom domain such as `lighting-ops.dimolanka.com` under *Vercel → Domains*.

Every push to the main branch redeploys the portal automatically, and every pull request gets a preview URL.

## 6. Build the mobile apps with EAS

The app identifiers are **`lk.dimo.lightingops`** on both platforms (`app.json`). Change them before the
first store build if DIMO prefers another ID. They cannot change after publishing.

```bash
cd dimo-lighting-ops
npx eas-cli@latest login
npx eas-cli@latest init                    # creates the EAS project and writes extra.eas.projectId into app.json
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production --environment preview --environment development --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production --environment preview --environment development --visibility plaintext
```

### Push notification credentials

* **Android (FCM V1):** create a Firebase project → add an Android app with package `lk.dimo.lightingops` →
  *Project settings → Service accounts → Generate new private key*. Upload the JSON with
  `npx eas-cli@latest credentials` → Android → *Google Service Account → FCM V1*.
* **iOS (APNs):** EAS creates and manages the push key during the first iOS build when you sign in with
  your Apple Developer account.

### Builds

| Purpose | Command |
|---|---|
| Development client (for `npx expo start` on a real phone) | `npx eas-cli@latest build --profile development --platform all` |
| Internal test build for field sales (Android APK / iOS ad-hoc) | `npx eas-cli@latest build --profile preview --platform all` |
| Store builds | `npx eas-cli@latest build --profile production --platform all` |
| Submit to the stores | `npx eas-cli@latest submit --platform android` / `--platform ios` |
| Over-the-air JS update (no store review) | `npx eas-cli@latest update --branch production --message "…"` (run `npx expo install expo-updates` and `eas update:configure` once first) |

Push notifications only work on real devices with a development, preview or production build, not in Expo Go.
The app registers the device token after sign-in, and taps open the related record.

## 7. User acceptance testing (maps to SRS 11.2)

Create one test user per role (`Settings → Users`). A suggested order of tests:

| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Sales (ASM Building) | Create a customer with a unit and contact. Create a project with name + customer + duration | Exact duplicate blocked; similar names listed; term suggested from duration |
| 2 | Sales | Turn on airplane mode, **Check in → Save visit report**, then turn it off | Visit queued offline, then synced with device check-in time and GPS |
| 3 | Sales | Plan next week (**Plan**), submit before Saturday 13:00 | SM Projects gets it in **Approvals**; a late submission is flagged |
| 4 | Sales (ASM Infra) | Plan a visit to ASM Building's customer | SM Projects alerted; can approve as joint, reassign or reject |
| 5 | Sales | From a visit: **Convert to inquiry** Route A, Duty Paid, attach a drawing, submit | Status *Submitted*; Design Manager notified; release-mode approval goes to SM Projects |
| 6 | Design Manager | Accept → Assign designer with a date later than requested | Reason required; sales and SM Projects notified |
| 7 | Designer | Confirm date → progress/hours → upload design pack → brands → Submit for review | Design Manager review; return logs a review cycle |
| 8 | Design Manager | Approve → Release design | Moves to Estimation; sales sees only the tracker (no design files yet in mode 3) |
| 9 | SM Estimation | Accept → Assign (default estimator pre-selected) | Due date must leave 1 working day before the customer deadline |
| 10 | Estimator | Save estimate (value, cost, margin, brands) → upload draft PDF + costing → Submit | Blocked until both files are uploaded |
| 11 | SM Estimation | Approve | Above the value / below the margin limit → GM approval |
| 12 | Estimator | Upload final PDF, compliance and TDS → Release | Sales push "Quotation released"; sales can download the final PDF and design pack, **not** the costing sheet |
| 13 | Sales | Record submission → client response → result Won with order value | Project milestone *Won*, probability 100% |
| 14 | Anyone | Put a job on hold, then resume | Clock grey while on hold; due date extended by the hold time |
| 15 | Admin | In SQL, set a clock's `due_at` to 3 days ago and run `select public.sla_tick();` | Red; L1→L3 notifications reach the owner, manager, sales, SM and GM |
| 16 | Operations | **Debtors Upload** with the template (download it from the screen) | Preview with totals; unmatched rows mapped; confirmed debts appear in each sales person's **My Debtors** with ageing colours |
| 17 | Operations | Place a debt under Legal (≤180 characters + hearing date) | Critical push to GM, SM Projects and Operations 2 days before the hearing |
| 18 | Sales → Ops → SM | Sample request → availability → approval → handover (with delivery-note photo) → return | Push at every step; overdue reminders after the return date |
| 19 | GM | **Overall Dashboard**, **Reports** → export PDF and Excel | Branded PDF with watermark and the user name; each role sees only its own reports |
| 20 | Everyone | **Search** | Results only from the user's scope |

## 8. SRS coverage

| SRS | Status | Where |
|---|---|---|
| 2 Roles, visibility, profile picture, account transfer, global search | ✅ | `profiles`, `…08_security.sql`, `profile.tsx`, Settings → Users, `search.tsx` |
| 4.1–4.3 Visits, master data, offline, project register, stakeholder map | ✅ | `visits/*`, `projects/*`, `lib/offline.ts` |
| 4.4 Weekly plan, approval, changes with reasons, plan-vs-actual, evaluation | ✅ | `plan/*`, `plan_vs_actual()` |
| 4.5 Duplicate customer visit control | ✅ | visit trigger, `submit_visit_plan`, `resolve_duplicate_line` |
| 4.6 **Visit map and month comparison** | ⚠️ Data captured (GPS, distance, compliance flag); **map screen not built** – waits for the Google Maps vs OpenStreetMap decision | — |
| 4.7 Win probability bands, prompts, overrides, log | ✅ (forecast-accuracy report not built) | `projects/[id].tsx`, `set_project_probability` |
| 4.8 Tender option and mandatory result form | ✅ | `VisitBits.tsx`, `tenders` |
| 4.9 Customer profiles, units, project creation/assignment, project term | ✅ | `customers/*`, `projects/new.tsx` |
| 4.10 Dormant and on-hold review | ✅ | `reminders_tick`, `review_project` |
| 5 Inquiries, routes, duty/currency, mixed duty, expectation, deadlines, debtor check, multiple inquiries | ✅ | `inquiries/*`, `…06_workflow_rpcs.sql` |
| 5.4 My Pending Designs & Estimations, delay pushes | ✅ | `inquiries/index.tsx`, SLA ladder |
| 6 Design workflow, electrical scope, release modes, early release, client approval loop | ✅ | `design/[id].tsx`, `release_design`, `record_client_response` |
| 7 Estimation workflow, restricted costing, quotation files and naming, validity, clarifications | ✅ | `estimation/[id].tsx`, `release_quotation` |
| 8 SLA clocks, colours, escalation, repeats, quiet hours, digest, re-send unopened | ✅ | `…05_sla_engine.sql`, `app.delivery_time`, `push-dispatch` |
| 8.6 Approvals matrix | ✅ mostly. Items 16–18 (KPI/team targets and scorecard corrections) are simplified: GM saves targets directly; there is no scorecard lock or correction workflow yet. Item 21 (settings approval): GM and sys_admin edit directly | `approvals.tsx`, `decide_approval` |
| 9, 9.1 Role dashboards and Overall Dashboard | ✅ (visit map panel waits for 4.6) | `home/*` |
| 9.2 Salesperson KPIs and scorecard | ✅ calculated from data; the weightings are editable | `scorecard.tsx`, `salesperson_scorecard()` |
| 9.3 Client and category view | ✅ client view; the category view is available through report filters | `customers/[id].tsx`, report *client_view* |
| 9.4 Term and win-probability reports | ✅ | `reports/[key]` |
| 9.5 Branded PDF / Excel | ✅ logo, title, filters, info block, repeated headers, totals, watermark with user and time. "Page X of Y" shows in Chrome-based browsers; phone print engines may omit it | `lib/export.ts` |
| 9.6 Design and estimation team performance | ✅ | `team_performance()` |
| 9.7 Role-based Reports tab | ✅ run log. **Not built:** saved favourite filters, scheduled delivery to a Reports inbox, 90-day re-download | `reports/*` |
| 9.8 Team structure map | ⚠️ delivered as a table (people, manager, pending, due, overdue). The interactive picture org chart is not built | report *team_map* |
| 10.3 Non-functional | ✅ HTTPS, RLS, audit of changes and downloads, archive-only core records. Operational items: enable MFA (3.2), use the Pro plan backups, add virus scanning of uploads if required | — |
| 12 Debtors | ✅ upload, validation, mapping, snapshots, ageing colours, reminders, crossings, non-moving, legal, categorised PDF | `debtors/*` |
| 13 Samples | ✅ | `samples/*` |

### Assumptions made where the SRS leaves a decision open (11.3)

* **Cost and margin visibility:** SRS 7.2 and 7.5 allow SM Projects, while matrix 10.2 does not. This build follows 7.2/7.5,
  so SM Projects can see cost and margin. To remove access, delete `'sm_projects'` from `app.can_read_costing()`.
* **GM approval thresholds:** LKR 50 M value / 15% margin (settings; change them after confirmation).
* **Design Manager reports to** SM Projects (Level 2 design escalation goes to SM Projects).
* **Operations Executive reports to** GM / DGM; "Operations manager" in the legal notice is read as the Operations Executive.
* **Non-moving debt** = 14 days; **repeat visit** = 7 days; **plan deadline** Saturday 13:00; **GPS radius** 500 m – all in settings.
* **Default quotation validity** 30 days; **sample SM alert** after 7 days overdue.
* Estimation hold needs SM Estimation approval, and the clock keeps running while waiting for supplier prices (7.3).

## 9. Suggested next steps

1. **Visit map (4.6 / 9.1):** pick a provider. OpenStreetMap via Leaflet is free on web; Google Maps needs an
   API key and billing. Add a map screen that reads `visits.checkin_lat/lng`, plus the month comparison.
2. **Scheduled reports:** add a `report_schedules` table and an Edge Function that renders PDFs server-side
   (e.g. with a headless browser service). This also gives exact page numbers and the Monday 08:00 Overall Dashboard PDF.
3. **Web push when the browser is closed:** add a service worker and VAPID keys. Today, web users get in-app
   notices plus browser notifications while the portal is open.
4. **Scorecard lock and correction approval (9.2, 8.6 #18),** the forecast-accuracy report (4.7) and the picture org chart (9.8).
5. **Data migration:** load open projects and inquiries with a one-off SQL/CSV import (organizations → projects → inquiries).
6. **Branding:** replace the placeholder icons in `assets/` with DIMO artwork (icon 1024×1024, adaptive icon layers, favicon).

## 10. Project layout

```
dimo-lighting-ops/
  app.json, eas.json, vercel.json          App, build and hosting config (bundle id lk.dimo.lightingops)
  src/app/                                 Screens (Expo Router)
    _layout.tsx, sign-in.tsx               Auth gate
    (app)/_layout.tsx                      Sidebar (web) / bottom bar (phone), header search + bell
    (app)/index.tsx                        Role home: My Day, Design Board, Estimation Board, Overall Dashboard, Operations
    (app)/visits, plan, projects, customers, inquiries, design, estimation,
          approvals, notifications, debtors, samples, reports, scorecard, admin, profile, search
  src/components/                          UI kit, dialogs, pickers, attachments, boards, forms
  src/lib/                                 Supabase client, auth, roles & report catalogue, offline queue,
                                           files, push, export (PDF/Excel), report builders, formatting
  supabase/migrations/                     Database: schema, workflow, SLA engine, security, scheduler
  supabase/seed.sql                        Master lists, SLA defaults, settings
  supabase/functions/                      push-dispatch, admin-users
  supabase/tests/                          Plain-PostgreSQL stub + end-to-end workflow test
```
