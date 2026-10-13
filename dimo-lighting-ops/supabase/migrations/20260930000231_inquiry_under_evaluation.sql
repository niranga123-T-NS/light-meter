-- Inquiry result "Under evaluation": the client is evaluating the quotation. Not a final result – the inquiry stays with the
-- sales person for follow-up (like "awaiting client approval") until Won / Lost / On hold / Cancelled is recorded.
-- Optional: the date the client's decision is expected, and a note.

alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check check (status in (
  'draft', 'submitted', 'returned_for_info', 'rejected', 'accepted', 'in_design', 'design_review', 'design_approved',
  'in_estimation', 'estimation_review', 'quotation_released', 'returned_to_sales', 'submitted_to_client',
  'awaiting_client_approval', 'under_evaluation', 'client_approved', 'won', 'lost', 'on_hold', 'cancelled'));

alter table public.inquiries add column if not exists evaluation_until date;
alter table public.inquiries add column if not exists evaluation_note text;

-- Treat it as the client-side statuses everywhere they are listed (follow-up lists, owner, progress, revision, copy to contractor)
do $$
declare f text; def text; before text;
begin
  foreach f in array array['public.my_day()', 'app.refresh_inquiry(uuid)', 'public.request_quotation_revision(uuid, text)',
                           'public.copy_quotation_to_contractor(uuid, uuid, uuid, uuid, date, text)', 'app.sales_meeting_pack(date)', 'app.inquiry_open(public.inquiries)'] loop
    def := pg_get_functiondef(f::regprocedure);
    before := def;
    def := replace(def, '''awaiting_client_approval'')', '''awaiting_client_approval'', ''under_evaluation'')');
    def := replace(def, '''awaiting_client_approval'', ''client_approved''', '''awaiting_client_approval'', ''under_evaluation'', ''client_approved''');
    def := replace(def, 'when ''awaiting_client_approval'' then 100', 'when ''awaiting_client_approval'' then 100 when ''under_evaluation'' then 100');
    perform app.require(def <> before, f || ': status list not found');
    execute def;
  end loop;
end $$;

create or replace function public.record_inquiry_evaluation(p_inquiry uuid, p_until date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.inquiries := app.inq(p_inquiry);
begin
  perform app.require(i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'gm'), 'Only the sales person records the result');
  perform app.require(i.status in ('quotation_released', 'submitted_to_client', 'awaiting_client_approval', 'client_approved', 'under_evaluation'),
    'Under evaluation is recorded after the quotation is released');
  perform app.require(p_until is null or p_until >= current_date, 'The decision date cannot be in the past');
  perform set_config('app.workflow', '1', true);
  update public.inquiries set evaluation_until = p_until, evaluation_note = nullif(btrim(p_note), '') where id = i.id;
  perform app.set_inquiry_status(i.id, 'under_evaluation',
    concat_ws(' · ', 'Client evaluating the quotation', case when p_until is not null then 'decision expected by ' || to_char(p_until, 'DD Mon YYYY') end, nullif(btrim(p_note), '')));
  perform app.refresh_inquiry(i.id);
end $$;

grant execute on function public.record_inquiry_evaluation(uuid, date, text) to authenticated;
