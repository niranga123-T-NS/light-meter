-- DIMO Sales – design team role.
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
alter type public.app_role add value if not exists 'designer';
