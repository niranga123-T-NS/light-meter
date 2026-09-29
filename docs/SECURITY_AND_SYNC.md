# Security, offline sync and data policies

This document answers the policy questions in section 10 of the brief: project deduplication, offline sync and conflicts, GPS, audit retention, backup and recovery, and dashboard refresh time.

## 1. Source of truth

The Supabase PostgreSQL database is the single source of truth. The phone keeps a **reference cache** (lists, accounts, contacts, projects, packages, and the user's own open actions and planned visits) and an **outbox** of visits captured on the device. The Excel workbook is always generated from the database; there is no shared workbook that the app writes to.

## 2. Roles and permissions

All permissions are enforced **in the database** with row-level security (RLS), whatever client is used (app, web, API). A deactivated or not-yet-activated user gets nothing: a restrictive policy on every table requires an active role.

| | Salesperson | Sales manager | Design / Estimation teams | Administrator |
|---|---|---|---|---|
| Customers & contacts | Read own + own territory + accounts on visible projects; create in own territory; edit own | All; assign owner & territory | Read accounts on assigned projects | All |
| Visits | Create own; edit while planned/draft; request corrections after submit | Read all; plan for team; edit (audited); approve corrections | Read visits linked to assigned projects; **cannot edit** | As manager |
| Projects & packages | Own, own-territory and shared (member) projects | All | Assigned projects (read); add notes, milestones, quotations | All |
| Actions | Own, created, territory, linked to visible visits/projects | All | On assigned projects | All |
| Design / estimation requests | Create on visible packages, follow progress, request revisions, cancel while new | All | Own team's queue: assign, start, hold, submit (cannot change the other team's work) | All |
| Quotations | On visible packages | All | On assigned projects | All |
| Cost & gross margin | **Hidden** (default) | Visible | Hidden unless added to `margin_visible_roles` | Visible |
| Pipeline stages | Read | Configure | Read | Configure |
| Lists, territories, settings, users | Read | Exchange rates | Read | Manage |
| Audit log | – | Read | – | Read |
| Excel export | Own visible data (no margin) | All data | Assigned project data | All data |

Territory rule: a salesperson sees records whose territory is one of theirs (Admin › Users) or that have no territory yet; they always see records they own, created, or visited.

Every insert, update and delete on business tables writes an `audit_log` row: table, record, user, time, changed fields, and before/after values. Exports are also logged (`export_log`, plus an `export` audit row) with the filters and row counts.

## 3. Duplicate prevention

| Record | Rule |
|---|---|
| Customer | **Same normalised legal name + same city = same customer.** Normalisation lower-cases, removes punctuation and drops suffixes such as (Pvt), Ltd, PLC, Limited, Company, Holdings. Enforced by a unique index. While typing a new name the app shows possible matches (offline cache + server similarity search, including other territories) and offers "Use this". |
| Project | **Same normalised name, or a known alias, + same district = same project.** Unique index on name + district; aliases (e.g. "LT2") are matched when visits create projects. |
| Contact | Same customer + same normalised name, or same e-mail, = same person (e-mail unique per customer). |
| Visit, action, attachment | The ID is generated on the device, so re-sending the same visit never creates a second copy. |

When two salespeople create the same new customer or project offline, the first submission creates it. The second is **matched to the existing record** and its visit is linked there (acceptance test "Concurrent entry"). If the match is in another territory, the salesperson is added as a sales member of that project so the history stays complete.

## 4. Offline capture, sync and conflicts

* **Drafts** autosave on the device (SQLite) as the salesperson types, with no signal needed. Photos and files are copied into app storage straight away.
* **Submit** checks the required fields on the device, then marks the visit **Queued**. The sync engine sends queued visits immediately when online, when the network returns, when the app comes to the foreground, and every 2 minutes while anything is queued.
* **Sending a visit:** attachments upload first to a fixed path (a retry finds the file already there and carries on), then one `submit_visit` call saves the visit, new customers, contacts, projects, packages, stakeholders, links and actions in a **single transaction**. Either everything is saved or nothing is.
* **Retry safety:** if the response is lost after the server committed, the next attempt is recognised (`already_processed`) and returns the stored reference.
* **Statuses shown to the user:** Draft → Queued → Synced, or **Needs attention** with the server's message (for example a validation error or a permission change). The Sync screen shows the last successful sync, counts, and a retry button.
* **Original times are preserved:** `device_created_at`, check-in and check-out come from the device clock; `submitted_at` is the server time.
* **Conflict policy:**
  * *Visits* are owned by one salesperson and are only editable by them while planned/draft. If a manager changed a planned visit after the phone downloaded it, submitting is refused with a conflict (`base_version` check). The visit goes to Needs attention for the salesperson to review.
  * *Submitted visits* are immutable for the salesperson. Changes go through a **correction request**; the manager's approval applies only the corrected fields and is audited.
  * *Master records* (customers, projects, packages, actions) are edited online with **optimistic concurrency**: every row has a `version` and an update only succeeds if the version is unchanged. Otherwise the user is asked to reload, so nobody silently overwrites someone else's change.
* **Sign-out** is blocked while unsynced visits exist on the device.

## 5. GPS behaviour

* Location is **optional by default** and is taken **once** at check-in (and at check-out if the user agreed), after the user taps "Check in + location". The OS permission prompt explains why; there is **no background tracking**, and the background-location permission is blocked in the app configuration.
* Stored: latitude, longitude, reported accuracy in metres, and a `location_consent` flag. When no fix is available the reason is recorded (no permission, no signal, remote meeting, recorded later).
* If DIMO's policy makes GPS mandatory, set `gps_required = true` (Admin › Settings). Submission then needs a check-in location or a reason, and remote meetings are exempt.

## 6. Retention, backup and recovery

| Item | Default | Setting |
|---|---|---|
| Audit log | 7 years (2,555 days) | `audit_retention_days` |
| Export history | 2 years | `export_log_retention_days` |
| Synced visits kept on the phone | 30 days (the server keeps them permanently) | – |
| Attachments | Kept with the record (no automatic deletion) | pending DIMO decision |

`purge_expired()` runs daily through pg_cron (see DEPLOYMENT.md).

**Backups:** use a Supabase Pro plan (or above) with **Point-in-Time Recovery**. Proposed targets are **RPO ≤ 5 minutes** and **RTO ≤ 4 hours**. Daily logical backups (`supabase db dump`) are also copied to DIMO-owned storage weekly; restore steps are in DEPLOYMENT.md. Storage buckets are private; files are reached only through signed links that expire after 5 minutes (or 7 days for scheduled exports).

**Data ownership and exit:** the whole schema is plain PostgreSQL in `supabase/migrations`, and all data can be exported with `pg_dump` or through the Excel workbook.

## 7. Dashboard refresh

The dashboard subscribes to database changes (Supabase Realtime) on visits, actions, packages and projects, and refreshes about **1.5 seconds** after a change is committed. A visit captured offline appears as soon as the phone syncs. The dashboard and the Excel export use the same filter definitions, and the workbook's Summary sheet is computed in the same database call, so the numbers reconcile.

## 8. Transport and sign-in

* All traffic uses HTTPS/TLS (Supabase), and data at rest is encrypted by the platform.
* Sign-in is by email and password, or with **Microsoft (Entra ID / Microsoft 365)** through Supabase's Azure provider (set `EXPO_PUBLIC_MICROSOFT_SSO=true`).
* New Microsoft users are created **inactive** until an administrator assigns a role.
* **Offboarding:** Admin › Users › Deactivate. This bans the account in Auth, removes push tokens, and can reassign the user's customers, contacts, projects, open packages and open actions to another owner in one step (`reassign_owner`).
