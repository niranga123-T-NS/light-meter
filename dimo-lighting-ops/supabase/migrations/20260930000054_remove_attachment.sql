-- Remove a file uploaded by mistake. Only the person who uploaded it (or GM / DGM) can remove it. The file is archived,
-- not deleted, so the audit trail keeps it. Files that are already part of a released quotation or a released / approved
-- design cannot be removed – upload a new version instead.

create or replace function public.remove_attachment(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.attachments;
  inq uuid;
  owner uuid;
  st text;
begin
  select * into a from public.attachments where id = p_id for update;
  perform app.require(a.id is not null and a.archived_at is null, 'File not found');
  perform app.require(a.uploaded_by = auth.uid() or app.has_role('gm'), 'Only the person who uploaded the file can remove it');
  if a.entity_type = 'estimation_job' then
    select status, inquiry_id into st, inq from public.estimation_jobs where id = a.entity_id;
    perform app.require(st is distinct from 'released', 'This quotation is already released – upload a corrected version instead');
  elsif a.entity_type = 'design_job' then
    select status, inquiry_id into st, inq from public.design_jobs where id = a.entity_id;
    perform app.require(a.kind <> 'design_pack' or st not in ('approved', 'released'),
      'This design pack is already approved – upload a corrected version instead');
  elsif a.entity_type = 'inquiry' then
    inq := a.entity_id;
  end if;
  update public.attachments set archived_at = now() where id = a.id;
  -- Tell whoever is working on the inquiry that a request document was removed
  if a.entity_type = 'inquiry' then
    select current_owner_id into owner from public.inquiries where id = inq and status not in ('draft', 'won', 'lost', 'cancelled');
    if owner is not null and owner <> auth.uid() then
      perform app.notify(owner, 'file_removed', 'Inquiry document removed: ' || a.file_name,
        format('%s removed it%s', coalesce(app.display_name(auth.uid()), '—'), coalesce(' – ' || nullif(btrim(p_reason), ''), '')),
        'normal', 'inquiry', inq, app.inquiry_url(inq));
    end if;
  end if;
end $$;
revoke execute on function public.remove_attachment(uuid, text) from public, anon;
grant execute on function public.remove_attachment(uuid, text) to authenticated;
