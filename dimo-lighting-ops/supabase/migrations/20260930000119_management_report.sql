-- Management report (GM / DGM): a monthly report of the whole business built in the app from the P&L (OR file),
-- invoicing, sales, cash, execution and warranty data, with rule-based highlights and exceptions. Each generated report
-- is kept as a snapshot (the figures as they were) with the GM's management comments, to reopen or print later.

create table public.mgmt_reports (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  data jsonb not null,
  comments text,
  generated_by uuid not null default auth.uid() references public.profiles (id),
  generated_at timestamptz not null default now(),
  comments_by uuid references public.profiles (id),
  comments_at timestamptz
);
create index on public.mgmt_reports (month desc, generated_at desc);
alter table public.mgmt_reports enable row level security;
create policy mgmt_reports_read on public.mgmt_reports for select to authenticated using (app.has_role('gm'));
grant select on public.mgmt_reports to authenticated;

create or replace function public.save_mgmt_report(p_month date, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM generates the management report');
  perform app.require(p_month is not null and jsonb_typeof(p_data) = 'object', 'Nothing to save');
  insert into public.mgmt_reports (month, data) values (app.month_of(p_month), p_data) returning id into rid;
  return rid;
end $$;

create or replace function public.save_mgmt_comments(p_id uuid, p_comments text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM comments on the management report');
  update public.mgmt_reports set comments = nullif(btrim(p_comments), ''), comments_by = auth.uid(), comments_at = now() where id = p_id;
  perform app.require(found, 'Report not found');
end $$;

create or replace function public.delete_mgmt_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app.require(app.has_role('gm'), 'Only the GM / DGM deletes management reports');
  delete from public.mgmt_reports where id = p_id;
end $$;

revoke execute on function public.save_mgmt_report(date, jsonb), public.save_mgmt_comments(uuid, text), public.delete_mgmt_report(uuid) from public, anon;
grant execute on function public.save_mgmt_report(date, jsonb), public.save_mgmt_comments(uuid, text), public.delete_mgmt_report(uuid) to authenticated;
