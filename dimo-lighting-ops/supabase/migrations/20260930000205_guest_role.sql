-- A person from outside given temporary high level access: a login with no access of its own (own migration –
-- a new enum value cannot be used in the transaction that adds it)
alter type public.app_role add value if not exists 'guest';
