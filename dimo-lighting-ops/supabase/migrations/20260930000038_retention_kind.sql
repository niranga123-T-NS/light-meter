-- Retention due-date extensions are approved by GM / DGM (own file: a new enum value cannot be used in the same transaction)
alter type public.approval_kind add value if not exists 'retention_extension';
