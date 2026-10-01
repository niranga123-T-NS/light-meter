-- SM Projects approval to release quotations below the value limit (own file: a new enum value cannot be used in the same transaction)
alter type public.approval_kind add value if not exists 'quotation_sm_projects';
