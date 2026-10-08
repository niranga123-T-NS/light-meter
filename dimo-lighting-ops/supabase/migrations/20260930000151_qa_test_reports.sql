-- QA / QC test reports written in the app like a Word document: A4 pages with the project header and DIMO logo, free
-- text, tables, photos and readings. Draft → submitted → approved (published, locked, PDF) or returned by the SEE.
--  * Written by the project's Assistant Engineers or the SEE; drafts are saved as often as needed.
--  * Submitting goes to the project's Senior Electrical Engineer, who approves (publishes) or returns it with the reason.

create table if not exists public.qa_reports (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  exec_project_id uuid not null references public.exec_projects (id) on delete cascade,
  title text not null,
  test_record_id uuid references public.test_records (id) on delete set null,
  content_html text not null default '',
  page_setup jsonb not null default '{"orientation":"portrait","margins":"normal"}',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  version int not null default 1,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text
);
create index if not exists qa_reports_project on public.qa_reports (exec_project_id, status);
alter table public.qa_reports enable row level security;
drop policy if exists qa_reports_read on public.qa_reports;
create policy qa_reports_read on public.qa_reports for select to authenticated
  using (created_by = auth.uid() or (status <> 'draft' and (app.is_exec_internal(exec_project_id) or app.has_role('gm'))));
grant select on public.qa_reports to authenticated;

-- p: {title, content_html, page_setup, test_record_id}
create or replace function public.save_qa_report(p_exec uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.qa_reports; rid uuid := p_id;
begin
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'Enter the report title');
  perform app.require(length(coalesce(p ->> 'content_html', '')) <= 20000000, 'The report is too large – use fewer or smaller photos');
  if rid is null then
    perform app.require(app.has_role('senior_elec_engineer') or app.is_project_ae(p_exec), 'An Assistant Engineer of the project or the SEE writes test reports');
    perform app.require(exists (select 1 from public.exec_projects where id = p_exec and status = 'active'), 'Project not active');
    insert into public.qa_reports (code, exec_project_id, title, test_record_id, content_html, page_setup)
    values (app.next_code('QAR'), p_exec, btrim(p ->> 'title'), nullif(p ->> 'test_record_id', '')::uuid, coalesce(p ->> 'content_html', ''),
            coalesce(p -> 'page_setup', '{"orientation":"portrait","margins":"normal"}'))
    returning id into rid;
  else
    select * into r from public.qa_reports where id = rid for update;
    perform app.require(r.id is not null, 'Report not found');
    perform app.require(r.created_by = auth.uid(), 'Only the author edits the report');
    perform app.require(r.status in ('draft', 'returned'), 'The report is submitted – it can change only if the SEE returns it');
    update public.qa_reports set title = btrim(p ->> 'title'), test_record_id = nullif(p ->> 'test_record_id', '')::uuid,
      content_html = coalesce(p ->> 'content_html', ''), page_setup = coalesce(p -> 'page_setup', page_setup), updated_at = now()
    where id = r.id;
  end if;
  return rid;
end $$;

create or replace function public.submit_qa_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.qa_reports; see uuid;
begin
  select * into r from public.qa_reports where id = p_id for update;
  perform app.require(r.id is not null and r.created_by = auth.uid(), 'Only the author submits the report');
  perform app.require(r.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(length(regexp_replace(r.content_html, '<[^>]*>', '', 'g')) > 10 or r.content_html ~* '<img', 'Write the report first');
  update public.qa_reports set status = 'submitted', submitted_at = now(), version = case when r.status = 'returned' then version + 1 else version end,
    decided_by = null, decided_at = null where id = r.id;
  select see_id into see from public.exec_projects where id = r.exec_project_id;
  perform app.notify_many(array[see], 'qa_report', 'Test report to approve – ' || r.title,
    format('%s · %s · by %s', r.code, app.exec_head(r.exec_project_id), app.display_name(auth.uid())), 'normal', 'exec_project', r.exec_project_id,
    '/execution/qa-report/' || r.id);
end $$;

create or replace function public.decide_qa_report(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.qa_reports;
begin
  perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves test reports');
  select * into r from public.qa_reports where id = p_id for update;
  perform app.require(r.id is not null and r.status = 'submitted', 'Not waiting for approval');
  perform app.require(p_approve or coalesce(btrim(p_note), '') <> '', 'Say what needs to change');
  update public.qa_reports set status = case when p_approve then 'approved' else 'returned' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(p_note), '') where id = r.id;
  perform app.notify(r.created_by, 'qa_report', case when p_approve then 'Test report approved and published – ' else 'Test report returned – ' end || r.title,
    concat_ws(' · ', r.code, app.exec_head(r.exec_project_id), nullif(btrim(p_note), '')), 'normal', 'exec_project', r.exec_project_id,
    '/execution/qa-report/' || r.id, null, not p_approve);
end $$;

create or replace function public.delete_qa_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.qa_reports where id = p_id and created_by = auth.uid() and status = 'draft';
  perform app.require(found, 'Only your own draft can be deleted');
end $$;

revoke execute on function public.save_qa_report(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_qa_report(uuid, uuid, jsonb) to authenticated, service_role;
revoke execute on function public.submit_qa_report(uuid) from public, anon;
grant execute on function public.submit_qa_report(uuid) to authenticated, service_role;
revoke execute on function public.decide_qa_report(uuid, boolean, text) from public, anon;
grant execute on function public.decide_qa_report(uuid, boolean, text) to authenticated, service_role;
revoke execute on function public.delete_qa_report(uuid) from public, anon;
grant execute on function public.delete_qa_report(uuid) to authenticated, service_role;
