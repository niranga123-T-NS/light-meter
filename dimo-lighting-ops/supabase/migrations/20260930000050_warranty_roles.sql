-- Warranty: new roles and approval kind (own file – new enum values cannot be used in the same transaction)
--   senior_elec_engineer – Senior Electrical Engineer – Project Execution
--   assistant_engineer   – Assistant Engineer (reports to the Senior Electrical Engineer)
alter type public.app_role add value if not exists 'senior_elec_engineer';
alter type public.app_role add value if not exists 'assistant_engineer';
alter type public.team add value if not exists 'execution';
-- Out-of-warranty claim covered as goodwill → SM Projects approves
alter type public.approval_kind add value if not exists 'warranty_goodwill';
