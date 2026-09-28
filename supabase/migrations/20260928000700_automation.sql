-- DIMO Sales Visit & Project Tracking — automated management alerts (Release 2)
-- Escalation of overdue actions, alert digests for the daily-alerts Edge
-- Function, and device push tokens for reminders.

insert into public.app_settings (key, value, description) values
  ('escalation_days', '3', 'Open actions this many days overdue are escalated to managers'),
  ('alert_email_enabled', 'true', 'Send daily alert emails (requires RESEND_API_KEY on the Edge Function)')
on conflict (key) do nothing;

create table public.device_push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon;
create policy own_tokens on public.device_push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mark long-overdue actions as escalated (to the first active manager of the
-- same territory, else any manager). Returns the number escalated.
create or replace function public.escalate_overdue_actions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.actions a set
    escalated = true,
    escalated_to = coalesce(
      (select p.id from public.profiles p join public.profile_territories pt on pt.user_id = p.id
       where p.active and p.role = 'manager' and pt.territory_id = a.territory_id order by p.created_at limit 1),
      (select p.id from public.profiles p where p.active and p.role = 'manager' order by p.created_at limit 1)),
    escalation_note = coalesce(escalation_note, 'Automatically escalated: overdue since ' || a.due_date)
  where a.status in ('open', 'in_progress') and not a.escalated
    and a.due_date < (now() at time zone 'Asia/Colombo')::date
                     - coalesce((public.setting('escalation_days') #>> '{}')::int, 3);
  get diagnostics n = row_count;
  return n;
end $$;

-- One digest per active user: their own overdue / due-soon actions; managers
-- also get escalations, tender deadlines and pending corrections.
create or replace function public.alert_digests() returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Colombo')::date d)
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object(
      'user_id', p.id, 'email', p.email, 'name', p.full_name, 'role', p.role,
      'push_tokens', coalesce((select jsonb_agg(token) from public.device_push_tokens t where t.user_id = p.id), '[]'),
      'overdue', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress') and a.due_date < today.d), '[]'),
      'due_soon', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date) order by a.due_date)
                  from public.actions a, today where a.owner_id = p.id and a.status in ('open', 'in_progress')
                    and a.due_date between today.d and today.d + coalesce((public.setting('reminder_days_before') #>> '{}')::int, 1)), '[]'),
      'escalated', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', a.code, 'description', a.description, 'due_date', a.due_date, 'owner', o.full_name) order by a.due_date)
                  from public.actions a left join public.profiles o on o.id = a.owner_id
                  where a.escalated and a.status in ('open', 'in_progress') and (a.escalated_to = p.id or p.role = 'admin')), '[]') else '[]' end,
      'deadlines', case when p.role in ('manager', 'admin') then coalesce((
                  select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'tender_closing_date', pr.tender_closing_date,
                                                      'quotation_due_date', pr.quotation_due_date))
                  from public.projects pr, today where pr.status = 'active' and pr.deleted_at is null
                    and (pr.tender_closing_date between today.d and today.d + 7 or pr.quotation_due_date between today.d and today.d + 7)), '[]') else '[]' end,
      'pending_corrections', case when p.role in ('manager', 'admin')
                  then (select count(*) from public.correction_requests where status = 'pending') else 0 end
    ) x
    from public.profiles p where p.active
  ) t
  where jsonb_array_length(x -> 'overdue') + jsonb_array_length(x -> 'due_soon') + jsonb_array_length(x -> 'escalated')
        + jsonb_array_length(x -> 'deadlines') + (x ->> 'pending_corrections')::int > 0
$$;

revoke execute on function public.escalate_overdue_actions(), public.alert_digests() from public, anon, authenticated;
