-- New approval kind: the Design Manager's design completion date, approved by SM Projects (own file so the
-- enum value is committed before it is used).
alter type public.approval_kind add value if not exists 'design_due';
