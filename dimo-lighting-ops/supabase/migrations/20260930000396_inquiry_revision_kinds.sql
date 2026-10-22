-- Client revisions after the quotation went out: the sales person says what is to be revised and the new deadline.
--   Revised quotation            → SM Estimation assigns an estimator (as before)
--   Revised design               → Design Manager assigns designers the usual way; the released design goes to
--   Revised design and quotation   SM Estimation (accept, assign) for the quotation – whatever the inquiry's release mode
-- The new deadline is recorded as a deadline change and splits into design / final pricing dates as usual.

alter table public.inquiries add column if not exists revision_kind text check (revision_kind in ('quotation', 'design', 'both'));
alter table public.inquiries add column if not exists revision_request text;

create or replace function public.request_revision(p_inquiry uuid, p_kind text, p_comments text, p_deadline date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  n public.inquiries;
  what text := case p_kind when 'quotation' then 'Revised quotation' when 'design' then 'Revised design' when 'both' then 'Revised design and quotation' end;
  jid uuid;
  old_end timestamptz;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person requests a revision');
  perform app.require(what is not null, 'Choose what the client wants revised');
  perform app.require(coalesce(trim(p_comments), '') <> '', 'Enter what the client wants changed');
  perform app.require(p_deadline is not null, 'Set the deadline for the revision');
  perform app.require(p_deadline >= current_date, 'The deadline cannot be in the past');
  perform app.require(i.status in ('quotation_released', 'submitted_to_client', 'awaiting_client_approval', 'under_evaluation', 'client_approved'),
    'A revision can be requested only after the quotation was released');
  perform app.require(not exists (select 1 from public.estimation_jobs where inquiry_id = i.id and status <> 'released'),
    'A revision is already in progress for this inquiry');

  if p_kind = 'quotation' then
    jid := public.request_quotation_revision(i.id, p_comments);
  else
    perform app.require(i.route <> 'B' and exists (select 1 from public.design_jobs where inquiry_id = i.id and status = 'released'),
      'This inquiry was priced without a design by us – request a revised quotation');
    perform app.require(not exists (select 1 from public.design_jobs where inquiry_id = i.id and status <> 'released'),
      'A design revision is already in progress for this inquiry');
    perform set_config('app.workflow', '1', true);
    update public.inquiries set revision = revision + 1, client_response = null where id = i.id;
    perform app.stop_clocks('inquiry', i.id, 'sales_submission');
    -- Back in the Design Manager's queue; designers are assigned the usual way
    perform app.set_inquiry_status(i.id, 'accepted', format('Client requested a %s (R%s): %s', lower(what), i.revision + 1, trim(p_comments)));
    perform app.start_clock(i.id, 'inquiry', i.id, 'assignment', (app.role_users('design_manager'))[1], null, 'Assign design revision');
    perform app.notify_many(app.role_users('design_manager') || app.design_team_of(i), 'design_revision',
      format('%s requested: %s-R%s', what, i.code, i.revision + 1),
      format('%s – %s · by %s · %s', i.project_name, i.customer_name, to_char(p_deadline, 'DD Mon YYYY'), trim(p_comments)),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id), null, true);
    perform app.notify_many(app.role_users('sm_estimation'), 'design_revision',
      format('%s requested: %s-R%s', what, i.code, i.revision + 1),
      format('%s – %s. The revised design comes to you for the quotation after the Design Manager releases it.', i.project_name, i.customer_name),
      'normal', 'inquiry', i.id, app.inquiry_url(i.id));
  end if;

  perform set_config('app.workflow', '1', true);
  update public.inquiries set revision_kind = p_kind, revision_request = what || ': ' || trim(p_comments) where id = i.id;
  -- The revision's deadline (a revision answers the client, so it is a client deadline even on a closed tender)
  n := app.inq(i.id);
  old_end := app.deadline_end(n);
  if n.deadline_type = 'tender' then update public.inquiries set deadline_type = 'client' where id = n.id; end if;
  if old_end is distinct from (p_deadline + app.work_end()) at time zone app.tz() then
    insert into public.deadline_extensions (inquiry_id, kind, old_deadline, new_deadline, reason, status, requested_by, decided_by, decided_at)
    values (n.id, 'direct', old_end, (p_deadline + app.work_end()) at time zone app.tz(), format('%s R%s', what, n.revision), 'granted', auth.uid(), auth.uid(), now());
  end if;
  perform app.apply_deadline(n.id, p_deadline, null, format('%s R%s', what, n.revision));
  perform app.refresh_inquiry(n.id);
  return coalesce(jid, n.id);
end $$;
revoke execute on function public.request_revision(uuid, text, text, date) from public, anon;
grant execute on function public.request_revision(uuid, text, text, date) to authenticated, service_role;

-- A requested design revision goes on to Estimation even when the inquiry's design normally goes to sales first;
-- the estimate carries the request and the last released estimate (its quotation and files stay visible)
do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.release_design(uuid, text)'::regprocedure);
  before := def;
  def := replace(def, '  if i.release_mode = 1 then', '  if i.release_mode = 1 and coalesce(i.revision_kind, '''') not in (''design'', ''both'') then');
  perform app.require(def <> before, 'release_design: release mode check not found'); before := def;
  def := replace(def, 'insert into public.estimation_jobs (inquiry_id, revision, source, status) values (i.id, i.revision, ''design'', ''queued'') returning id into ej;',
    'insert into public.estimation_jobs (inquiry_id, revision, source, status, previous_job_id, revision_request)
      values (i.id, i.revision, ''design'', ''queued'',
              (select p.id from public.estimation_jobs p where p.inquiry_id = i.id and p.status = ''released'' order by p.revision desc, p.released_at desc limit 1),
              case when i.revision_kind in (''design'', ''both'') then i.revision_request end)
      returning id into ej;');
  perform app.require(def <> before, 'release_design: estimation job insert not found'); before := def;
  def := replace(def, 'perform app.set_inquiry_status(i.id, ''in_estimation'', ''Design released to Estimation'');',
    'perform app.set_inquiry_status(i.id, ''in_estimation'', ''Design released to Estimation'');
    update public.inquiries set revision_kind = null where id = i.id and revision_kind in (''design'', ''both'');');
  perform app.require(def <> before, 'release_design: in_estimation status not found');
  execute def;
end $$;

select app.fix_function_owners();
