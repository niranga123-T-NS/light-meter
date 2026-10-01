-- Design revision numbers: every time the Design Manager returns (rejects) a design, the next submission is the next
-- "Design Rev" (Rev 0 = first submission). Shown on screens, in notifications and in the design file names.

create or replace function public.submit_design_for_review(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job); code text;
begin
  perform app.require(j.assignee_id = auth.uid(), 'Only the assignee can submit');
  perform app.require(j.status in ('in_progress', 'acknowledged', 'returned', 'assigned'), 'Job is not in progress');
  perform app.require(app.has_attachment('design_job', j.id, 'design_draft') or app.has_attachment('design_job', j.id, 'design_pack'),
    'Upload the design files before submitting');
  update public.design_jobs set status = 'in_review', submitted_at = now(), progress_pct = 100 where id = j.id;
  perform app.stop_clocks('design_job', j.id);
  perform app.start_clock(j.inquiry_id, 'design_job', j.id, 'design_review', (app.role_users('design_manager'))[1], null, 'Design review');
  perform app.log_status('design_job', j.id, j.inquiry_id, j.status, 'in_review', 'Design Rev ' || j.review_cycles);
  if not exists (select 1 from public.design_jobs where inquiry_id = j.inquiry_id and revision = j.revision
                 and id <> j.id and status not in ('in_review', 'approved', 'released')) then
    perform app.set_inquiry_status(j.inquiry_id, 'design_review');
  end if;
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  perform app.notify_many(app.role_users('design_manager'), 'design_submitted', format('Design ready for review: %s · %s design · Rev %s', code, j.task_type, j.review_cycles),
    app.display_name(auth.uid()) || case when j.review_cycles > 0 then format(' · revision %s after return', j.review_cycles) else '' end, 'normal', 'design_job', j.id, '/design/' || j.id, null, true);
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function public.review_design(p_job uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs := app.design_job(p_job); code text;
begin
  perform app.require(app.has_role('design_manager', 'gm'), 'Only the Design Manager reviews designs');
  perform app.require(j.status = 'in_review', 'Job is not in review');
  perform app.stop_clocks('design_job', j.id, 'design_review');
  select i.code into code from public.inquiries i where id = j.inquiry_id;
  if p_approve then
    update public.design_jobs set status = 'approved', approved_at = now(), review_comment = p_comment where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'approved', concat_ws(' · ', 'Design Rev ' || j.review_cycles, p_comment));
    if not exists (select 1 from public.design_jobs where inquiry_id = j.inquiry_id and revision = j.revision and status not in ('approved', 'released')) then
      perform app.set_inquiry_status(j.inquiry_id, 'design_approved');
    end if;
    perform app.notify(j.assignee_id, 'design_approved', format('Design approved: %s · Rev %s', code, j.review_cycles), coalesce(p_comment, ''), 'normal', 'design_job', j.id, '/design/' || j.id);
  else
    perform app.require(coalesce(trim(p_comment), '') <> '', 'Give review comments when returning');
    update public.design_jobs set status = 'returned', review_cycles = review_cycles + 1, review_comment = p_comment where id = j.id;
    perform app.log_status('design_job', j.id, j.inquiry_id, 'in_review', 'returned', format('Design Rev %s returned · next Rev %s · %s', j.review_cycles, j.review_cycles + 1, p_comment));
    perform app.start_clock(j.inquiry_id, 'design_job', j.id, 'design', j.assignee_id, greatest(j.due_at, now() + interval '1 minute'), 'Design (returned)');
    perform app.set_inquiry_status(j.inquiry_id, 'in_design', 'Returned by Design Manager');
    perform app.notify(j.assignee_id, 'design_returned', format('Design returned for changes: %s · prepare Rev %s', code, j.review_cycles + 1), p_comment, 'normal', 'design_job', j.id, '/design/' || j.id);
  end if;
  perform app.refresh_inquiry(j.inquiry_id);
end $$;

create or replace function app.attachments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare qno text; rev int; ext text;
begin
  if not app.can_write_attachment(new.entity_type, new.entity_id, new.kind) then
    raise exception 'You cannot upload files to this record';
  end if;
  new.version := coalesce((select max(version) from public.attachments
                           where entity_type = new.entity_type and entity_id = new.entity_id and kind = new.kind), 0) + 1;
  if new.entity_type = 'estimation_job' and new.kind in ('quotation_draft', 'quotation_final') then
    select coalesce(e.quotation_no, (select quotation_no from public.quotations q where q.inquiry_id = e.inquiry_id limit 1),
                    i.code), i.revision
      into qno, rev from public.estimation_jobs e join public.inquiries i on i.id = e.inquiry_id where e.id = new.entity_id;
    ext := coalesce(substring(new.file_name from '\.([A-Za-z0-9]+)$'), 'pdf');
    new.file_name := format('%s-R%s%s.%s', qno, rev, case when new.kind = 'quotation_draft' then '-draft-v' || new.version else '' end, ext);
  end if;
  -- Design files carry the inquiry revision, task and design revision: INQ-2026-00007-R0 Lighting Rev2 - drawing.pdf
  if new.entity_type = 'design_job' and new.kind in ('design_draft', 'design_pack') then
    select i.code || '-R' || i.revision || ' ' || initcap(d.task_type) || ' Rev' || d.review_cycles
      into qno from public.design_jobs d join public.inquiries i on i.id = d.inquiry_id where d.id = new.entity_id;
    if qno is not null and position(qno in new.file_name) = 0 then
      new.file_name := qno || ' - ' || new.file_name;
    end if;
  end if;
  return new;
end $$;
