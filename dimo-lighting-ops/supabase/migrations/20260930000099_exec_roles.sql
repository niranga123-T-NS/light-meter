-- Execution module: new roles (own file – new enum values cannot be used in the same transaction)
--   trainee        – Trainee (execution team, hired on demand; records work, cannot verify or approve)
--   sub_supervisor – Subcontractor supervisor (external; appointed per project; sees only own assigned work)
-- A Temporary Assistant Engineer is an assistant_engineer profile with is_temporary = true.
alter type public.app_role add value if not exists 'trainee';
alter type public.app_role add value if not exists 'sub_supervisor';
