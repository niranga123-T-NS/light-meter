-- Notifications: "Clear" moves them to the user's history; "Clear history" removes them from the history view.
-- Rows are kept (hidden), so alerts that are sent once or once a day are not sent again after clearing.
-- Unopened approval / overdue items (requires_open) stay in the list until they are opened.

alter table public.notifications add column if not exists cleared_at timestamptz;
alter table public.notifications add column if not exists history_cleared_at timestamptz;
create index if not exists notifications_history on public.notifications (recipient_id, cleared_at desc) where cleared_at is not null;

-- Clear one notification, or all delivered ones (p_id null). Returns how many were cleared.
create or replace function public.clear_notifications(p_id uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set cleared_at = now(), read_at = coalesce(read_at, now())
   where recipient_id = auth.uid() and cleared_at is null and deliver_after <= now()
     and (p_id is null or id = p_id)
     and (p_id is not null or read_at is not null or not requires_open);
  get diagnostics n = row_count;
  return n;
end $$;

-- Remove cleared notifications from the history: one (p_id), or all cleared before p_before (default: all)
create or replace function public.clear_notification_history(p_id uuid default null, p_before timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notifications set history_cleared_at = now()
   where recipient_id = auth.uid() and cleared_at is not null and history_cleared_at is null
     and (p_id is null or id = p_id) and (p_before is null or cleared_at < p_before);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.clear_notifications(uuid), public.clear_notification_history(uuid, timestamptz) from public, anon;
grant execute on function public.clear_notifications(uuid), public.clear_notification_history(uuid, timestamptz) to authenticated;
