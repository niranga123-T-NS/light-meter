# Data model

PostgreSQL (Supabase). The full definition is in `supabase/migrations`, and every column is listed in [FIELD_DICTIONARY.md](FIELD_DICTIONARY.md).

```
business_units ─< territories ─< profile_territories >─ profiles (users, role)
                                                         │ owner / salesperson / author
customers ─< contacts                                    │
   │  └─ parent_customer (group structure)               │
   ├──< visits >── visit_contacts >── contacts           │
   │      ├── visit_projects >── projects                │
   │      ├── visit_opportunities >── opportunities      │
   │      └──< actions                                   │
   └── projects (customer / developer / end user)        │
          ├──< project_stakeholders (customer and/or contact + role)
          ├──< project_members (estimators, designers, shared sales)
          ├──< opportunities (lighting packages / bids) ──< quotations ── quotation_financials (restricted)
          │         └──< opportunity_stage_history
          ├──< project_milestones (design / submittal)
          ├──< technical_notes
          └──< actions

attachments (entity_type + entity_id → any record; file in private storage)
correction_requests → visits          audit_log (every change)          export_log, export_schedules
lookup_values (configurable lists)    pipeline_stages    app_settings    exchange_rates    device_push_tokens
```

## Design decisions

* **One project master per physical project or tender.** Several consultants, contractors and salespeople link their visits and stakeholder roles to the same project. Each lighting package / bid is an `opportunity` with its own owner, value, currency, stage and probability, so separate bids keep independent values and stages.
* **One customer record per organisation.** A customer can be a project's owner, developer, end user or stakeholder (architect, MEP consultant, contractor, …) without being entered twice. Parent and subsidiary relationships use `parent_customer_id`.
* **IDs:** every row has a UUID primary key, generated on the phone for offline records, and a human-readable code issued by the server (`CUS-000123`, `CON-…`, `VIS-…`, `PRJ-…`, `OPP-…`, `ACT-…`, `QUO-…`).
* **Stamping:** `created_by/at`, `updated_by/at` and `version` are maintained by triggers. `version` provides optimistic concurrency.
* **Money:** amounts always carry an ISO currency. Base-currency figures (`*_base` in exports and dashboard) come from `exchange_rates` using the rate on or before the date; unlike currencies are never added without a rate.
* **Time:** `timestamptz` stored in UTC; displayed and exported in Asia/Colombo (+05:30). `visits.visit_date` is the Colombo calendar date.
* **Derived fields:** `weighted_value = estimated_value × probability ÷ 100`, `duration_minutes`, `last_visit_at` (customers), `last_activity_at` (projects and packages), a territory copied from the account or project, and a stage's default probability.
* **Soft delete:** customers, contacts, projects, packages and attachments have `deleted_at`. Only administrators can hard-delete.
* **Quotation revisions:** each revision is a row; a new revision automatically supersedes the previous draft or submitted one. Cost and gross margin live in `quotation_financials`, which has its own restrictive access rule.
