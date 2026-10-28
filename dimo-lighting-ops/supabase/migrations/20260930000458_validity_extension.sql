-- Quotation validity extension (Request a change › Validity extension) – design + estimation (A) and estimation only (B)
-- inquiries with a released quotation. The sales person gives the new valid-until date, the date it is needed by and the
-- reason; it goes to SM Estimation as a quotation revision (R+1) to assign an estimator, who re-checks the prices and sends
-- the quotation for approval and release as usual. The new job carries the requested valid-until date.

alter table public.estimation_jobs add column if not exists validity_extension boolean not null default false;

alter table public.inquiries drop constraint if exists inquiries_revision_kind_check;
alter table public.inquiries add constraint inquiries_revision_kind_check check (revision_kind in ('quotation', 'design', 'both', 'validity'));

create or replace function public.request_validity_extension(p_inquiry uuid, p_until date, p_needed_by date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.inquiries := app.inq(p_inquiry);
  prev public.quotations;
  what text;
  jid uuid;
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person requests a validity extension');
  perform app.require(i.route in ('A', 'B'), 'A validity extension applies to design + estimation or estimation only inquiries');
  perform app.require(coalesce(trim(p_reason), '') <> '', 'A reason is required');
  perform app.require(p_until is not null, 'Choose the new valid-until date');
  perform app.require(p_needed_by is not null, 'Set the date the extended quotation is needed by');
  select q.* into prev from public.quotations q join public.estimation_jobs e on e.id = q.estimation_job_id
   where e.inquiry_id = i.id and e.status = 'released' order by e.revision desc, q.released_at desc limit 1;
  perform app.require(prev.id is not null, 'There is no released quotation to extend');
  perform app.require(p_until > coalesce(prev.validity_date, current_date), format('The new validity must be after the current one (%s)', to_char(prev.validity_date, 'DD Mon YYYY')));
  perform app.require(p_until > p_needed_by, 'The new validity must be after the date it is needed by');

  what := format('Validity extension to %s (now valid until %s): %s', to_char(p_until, 'DD Mon YYYY'), coalesce(to_char(prev.validity_date, 'DD Mon YYYY'), '—'), trim(p_reason));
  jid := public.request_revision(i.id, 'quotation', what, p_needed_by);

  perform set_config('app.workflow', '1', true);
  update public.estimation_jobs set validity_extension = true, validity_until = p_until where id = jid;
  update public.inquiries set revision_kind = 'validity', revision_request = what where id = i.id;
  update public.notifications set kind = 'validity_extension', title = format('Validity extension requested: %s-R%s', i.code, i.revision + 1)
   where entity_type = 'estimation_job' and entity_id = jid and kind = 'quotation_revision';
  return jid;
end $$;
revoke execute on function public.request_validity_extension(uuid, date, date, text) from public, anon;
grant execute on function public.request_validity_extension(uuid, date, date, text) to authenticated, service_role;

select app.fix_function_owners();
