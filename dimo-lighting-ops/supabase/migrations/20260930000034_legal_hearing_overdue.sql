-- Legal debtors whose hearing date has passed without an update:
--  * the Operations Executive gets a push every day (from 07:00, weekends included) until the case is updated
--    with a new hearing date and comments, or closed with an outcome
--  * updating a legal case needs a hearing date that is not in the past and a comment on what happened

alter table public.debts add column if not exists hearing_overdue_alerted_on date;

create or replace function public.legal_hearing_tick(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  loc timestamp := p_at at time zone app.tz();
  today date := loc::date;
  r record;
  n int := 0;
begin
  if loc::time < time '07:00' then return 0; end if;
  for r in select * from public.debts
            where is_legal and legal_outcome is null and next_hearing_date < today
              and status not in ('cleared', 'collected_confirmed')
              and hearing_overdue_alerted_on is distinct from today loop
    perform app.notify_many(app.role_users('operations_exec'), 'legal_hearing_overdue',
      format('Hearing date passed – update now: %s', r.client_name),
      format('%s · %s · %s · hearing was %s (%s days ago). Enter the status, next hearing date and comments.',
             r.invoice_no, app.fmt_money(r.amount, r.currency), coalesce(r.legal_description, ''),
             to_char(r.next_hearing_date, 'DD Mon YYYY'), today - r.next_hearing_date),
      'critical', 'debt', r.id, '/debtors/' || r.id,
      -- first day shares the key of the existing "Enter the hearing outcome" prompt, so only one is sent
      case when today = r.next_hearing_date + 1 then format('outcome:%s:%s', r.id, r.next_hearing_date)
           else format('hearingpast:%s:%s', r.id, today) end, true);
    update public.debts set hearing_overdue_alerted_on = today where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.legal_hearing_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.legal_hearing_tick(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('legal-hearing-tick', '*/15 * * * *', 'select public.legal_hearing_tick()');
  end if;
end $$;

-- Legal update: description of the case, comments on this update, and a hearing date that is not in the past
drop function if exists public.set_debt_legal(uuid, boolean, text, date, text);
create or replace function public.set_debt_legal(
  p_debt uuid, p_is_legal boolean, p_description text, p_next_hearing date default null, p_outcome text default null,
  p_comment text default null
) returns void language plpgsql security definer set search_path = public as $$
declare d public.debts; today date := (now() at time zone app.tz())::date;
begin
  perform app.require(app.has_role('operations_exec'), 'Only the Operations Executive can set Legal status');
  perform app.require(char_length(coalesce(p_description, '')) between 1 and 180, 'Short description is required (max 180 characters)');
  perform app.require(not p_is_legal or p_next_hearing is not null or p_outcome is not null, 'Next hearing date is required while under Legal');
  perform app.require(p_outcome is not null or p_next_hearing is null or p_next_hearing >= today, 'The next hearing date cannot be in the past');
  select * into d from public.debts where id = p_debt for update;
  perform app.require(not d.is_legal or p_outcome is not null or coalesce(trim(p_comment), '') <> '',
    'Add comments on this update (what happened at the hearing / current status)');
  update public.debts set is_legal = p_is_legal and p_outcome is null, legal_description = p_description,
    next_hearing_date = case when p_outcome is null then p_next_hearing end,
    legal_outcome = p_outcome, hearing_alerted_for = null, hearing_overdue_alerted_on = null, last_status_at = now()
  where id = d.id;
  insert into public.debt_log (debt_id, kind, note, legal_description, next_hearing_date)
  values (d.id, 'legal', concat_ws(' · ', coalesce(p_outcome, case when p_is_legal then 'Legal' else 'Legal removed' end), nullif(trim(p_comment), '')),
          p_description, p_next_hearing);
end $$;
revoke execute on function public.set_debt_legal(uuid, boolean, text, date, text, text) from public, anon;
grant execute on function public.set_debt_legal(uuid, boolean, text, date, text, text) to authenticated, service_role;
