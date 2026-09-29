# Administrator and manager guide

All of these are in the app under **More** (web or mobile). The web dashboard is recommended for administration.

## Users and roles (administrators)

* **Invite user**: enter email, name, role and territories. Leave the password empty to send an email invitation, or set a temporary password.
* Roles: **Salesperson**, **Sales manager**, **Design team** (`designer`), **Estimation team** (`estimator`) and **Administrator**. Design and estimation users see their team's request queue and the projects those requests belong to.
* **Territories** control what salespeople see. Add estimators and designers to projects under Project › Team.
* **Deactivate** blocks sign-in immediately. Optionally choose a person to take over the leaver's accounts, projects, open packages and open actions. Deactivated users keep their history; nothing is deleted.
* People who sign in with Microsoft for the first time appear as *Inactive* until you activate them.

## Configurable lists (administrators)

Admin › Dropdown lists covers visit types, customer categories, industries, project types, lighting segments, visit outcomes, win/loss reasons, no-follow-up reasons, contact and location unavailable reasons, decision roles, stakeholder roles, influence stages, design stages, budget and specification status, lead sources, date confidence, strategic priority, milestone types, currencies and districts.

Codes are permanent because they are stored on records and exports. To retire a value, **deactivate** it rather than deleting it.

## Pipeline stages (managers)

Set the name, order, default probability, outcome type (open / won / lost / on hold / cancelled), and the fields required to leave or enter each stage. The server enforces these on every stage change.

## Settings (administrators) and exchange rates (managers)

| Setting | Meaning |
|---|---|
| `base_currency` | Currency of dashboard totals (default LKR) |
| `gps_required` | `true` makes check-in location (or a reason) mandatory |
| `margin_visible_roles` | Roles that can see quotation cost and margin, e.g. `["manager","admin"]` |
| `stale_project_days` | Days without activity before a project is flagged |
| `reminder_days_before` | Reminder lead time for actions |
| `escalation_days` | Days overdue before an action is escalated automatically |
| `audit_retention_days`, `export_log_retention_days` | Retention periods |
| `alert_email_enabled` | Daily alert emails on/off |

**Exchange rates**: enter the base-currency value of one unit of each foreign currency, with an effective date. Totals use the latest rate on or before the relevant date. Amounts without a rate are reported separately and are never added in.

## Corrections (managers)

More › Visit corrections lists pending requests with the proposed changes. Approve or reject them, optionally with a note. Only the correctable visit fields are applied; the salesperson, IDs and timestamps cannot be changed this way.

## Dashboard and exports (managers)

* Filter by period, owner, territory and stage. Tap any bar or tile to drill down to the records, then **Export** that view.
* **Excel export** creates the workbook with Read Me, Summary and one sheet per record type. **Scheduled exports** (daily, weekly or monthly) are built with your permissions, stored securely, and emailed as a 7-day link.
* **Audit log** shows every change with before and after values, plus every export.

## Importing existing customers

Admin › Import customers: copy rows from Excel **with the header row** and paste them. Recognised columns are listed on the screen, including `owner_email` and `territory_code`. Rows that match an existing customer (same normalised name and city) are skipped and marked as duplicates.

## Design & estimation settings

| Setting | Meaning |
|---|---|
| `design_sla_days` | Default days to complete a design request when no date is given (5) |
| `estimation_sla_days` | Default days for an estimation request (3) |
| `work_due_soon_days` | Reminder lead time for requests due soon (1) |

Lists: **Design task types**, **Estimation task types** and **Revision reasons** are under Admin › Dropdown lists.
The dashboard's **Design & estimation** section shows open / late / submitted work per team, on-time %, average turnaround, revision requests, workload per person, the late list and the average **inquiry → first quotation** time.
