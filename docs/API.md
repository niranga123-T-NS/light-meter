# API

Supabase exposes the database as a documented REST API (PostgREST). The OpenAPI description is served at `https://<ref>.supabase.co/rest/v1/` (send the `apikey` header). Every call runs with the caller's permissions (row-level security), so integrations such as a future ERP or Power BI connection should use a dedicated user account with the right role.

## Tables

Standard REST on each table, e.g. `GET /rest/v1/customers?select=id,code,legal_name&city=eq.Colombo`, `POST /rest/v1/actions`, `PATCH /rest/v1/opportunities?id=eq.<id>&version=eq.<n>` (send `version` to prevent overwriting someone else's change). See [FIELD_DICTIONARY.md](FIELD_DICTIONARY.md) for columns.

## Functions (POST `/rest/v1/rpc/<name>`)

| Function | Purpose |
|---|---|
| `submit_visit(p jsonb)` | Idempotent offline sync of a visit, with new customers/contacts/projects/packages/stakeholders, links, actions and attachment metadata, in one transaction. Returns `{visit_id, code, status, version, id_map, already_processed}`. Errors: `23514` validation (missing fields in `details`), `PT409` conflict, `42501` not permitted. |
| `find_similar_customers(q, p_city)` / `find_similar_projects(q, p_district)` | Possible duplicates (identifying fields only) with a similarity score and a `visible` flag. |
| `dashboard_summary(f jsonb)` | Dashboard measures for filters `{from, to, owner_id, territory_id, stage_id}`. |
| `export_dataset(f jsonb, p_channel)` | All workbook rows the caller may see plus the same summary, and logs the export. The app turns this into the .xlsx file (`supabase/functions/_shared/workbook.ts`). |
| `approve_correction(p_id, p_note)` / `reject_correction(p_id, p_note)` | Manager decision on a visit correction. |
| `reassign_owner(p_from, p_to)` | Administrator: move a leaver's records. |

Server-only (service role): `escalate_overdue_actions()`, `alert_digests()`, `purge_expired()`.

### `submit_visit` payload

```json
{
  "visit": { "id": "<uuid>", "customer_id": "<uuid>", "visit_type": "follow_up", "visit_date": "2026-09-28",
             "check_in_at": "2026-09-28T04:15:00Z", "purpose": "...", "summary": "...", "outcome": "positive", "...": "..." },
  "base_version": 2,
  "new_customers": [{ "id": "<uuid>", "legal_name": "...", "city": "Colombo" }],
  "new_contacts": [{ "id": "<uuid>", "customer_id": "<uuid>", "full_name": "..." }],
  "new_projects": [{ "id": "<uuid>", "name": "...", "district": "Colombo", "customer_id": "<uuid>" }],
  "new_opportunities": [{ "id": "<uuid>", "project_id": "<uuid>", "name": "...", "estimated_value": 1000000, "currency": "LKR" }],
  "new_stakeholders": [{ "project_id": "<uuid>", "customer_id": "<uuid>", "contact_id": "<uuid>", "stakeholder_role": "architect" }],
  "contact_ids": ["<uuid>"], "project_ids": ["<uuid>"], "opportunity_ids": ["<uuid>"],
  "actions": [{ "id": "<uuid>", "description": "...", "due_date": "2026-10-05", "owner_id": "<uuid>", "priority": "high" }],
  "attachments": [{ "id": "<uuid>", "storage_path": "<user>/visit/<visit>/<id>/photo.jpg", "filename": "photo.jpg", "mime_type": "image/jpeg" }],
  "submit": true
}
```

## Edge Functions

| Function | Caller | Purpose |
|---|---|---|
| `admin-users` | Administrator (user JWT) | invite / update / deactivate / reactivate users |
| `scheduled-export` | pg_cron (`x-cron-secret`) | build due scheduled workbooks as the schedule owner, store them, email links |
| `daily-alerts` | pg_cron (`x-cron-secret`) | escalate overdue actions, email/push daily digests |

## Storage

Private buckets: `attachments` (path `<uploader>/<entity_type>/<entity_id>/<attachment_id>/<file>`, 25 MB limit, images/PDF/Office/CAD/audio) and `exports`. Access is through short-lived signed URLs.
