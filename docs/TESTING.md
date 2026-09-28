# Testing

## 1. Database acceptance tests (brief section 8)

`scripts/test-db.sh` creates a throw-away PostgreSQL database and applies a small Supabase stand-in (`supabase/tests/local_shim.sql`). It then runs every migration and `seed.sql`, and executes `supabase/tests/acceptance.sql` as the different demo users.

```bash
PGHOST=localhost PGUSER=postgres scripts/test-db.sh
```

| Acceptance check | Covered by |
|---|---|
| Concurrent entry | Two salespeople create the same customer offline under different spellings; one customer, both visits linked |
| Offline entry | Visit with photo, action and device times; retrying the same payload creates no duplicates; original times kept |
| Project linking | Alias matched to existing project; several visits and stakeholders on one project; packages keep independent stage and probability; stage history |
| Action control | Overdue action visible to owner and on manager dashboard; completion time recorded, project history updated, audited |
| Excel reconciliation | Export rows equal dashboard counts and weighted value for the same filter; IDs join across sheets; foreign currency converted |
| Security and audit | Salesperson cannot see other territories or cost/margin (table and export); estimator limited to assigned project and cannot edit visits; submitted visit locked; correction approval audited; deactivated user sees nothing; no self-promotion; exports attributable |
| Rules and alerts | Incomplete visit rejected; stage entry requirements; drafts allowed; escalation and alert digests restricted to server |

## 2. API smoke test

This runs the app's actual queries and RPCs over HTTP as different users. Start PostgREST against a seeded test database (`SKIP_TESTS=1 TEST_DB=dimo_api scripts/test-db.sh`, with `jwt-secret` set in the PostgREST config), then:

```bash
node --experimental-strip-types scripts/api-smoke-test.mts http://localhost:3099 <jwt-secret> [output-dir]
```

It covers the offline cache queries, planning a visit, a visit from a planned visit creating a new customer/contact/project/package, retry idempotency, the embedded queries used by screens, optimistic-concurrency rejection, duplicate search, stage rules, estimator scope, the dashboard, and building the Excel workbook.

## 3. App checks

```bash
npx tsc --noEmit
npx expo lint
npx expo export --platform web       # bundles the web dashboard
npx expo export --platform android   # bundles the mobile JS
```

The web build was also driven end to end in a headless browser: sign in, open a customer, start a visit, see validation, complete and submit it, watch it sync, then view the manager dashboard and download the workbook.

## 4. Manual checks on devices

Run these on a development build on a real phone:

* **Offline:** switch to airplane mode, record a visit with photos and a new customer, submit it, reconnect, and check the Synced status and the VIS reference.
* **GPS:** try Check in + location with permission allowed and with it denied (the reason is recorded).
* **Reminders:** create an action due tomorrow and confirm a notification arrives at 08:30 Colombo time on the reminder day.
* **Two users:** two phones create the same new customer offline, then both sync. There should be one customer.
