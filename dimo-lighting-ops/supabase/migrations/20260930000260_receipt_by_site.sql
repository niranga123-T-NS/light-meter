-- The receipt of materials on site is the site team's (AE, SEE, subcontractor supervisor): what actually arrived goes into
-- the project store. Operations records the supplier's delivery note on the order, which asks the site to confirm.

drop function if exists public.receive_material(uuid, jsonb, text, uuid, text, text);
create or replace function public.receive_material(p_id uuid, p_lines jsonb, p_note text default null, p_supervisor uuid default null,
  p_custody text default 'dimo', p_company text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.material_requests; l jsonb; ln public.material_request_lines; q numeric; out_lines jsonb := '[]'; rid uuid; sub uuid; by_sub boolean := app.has_role('sub_supervisor');
begin
  select * into m from public.material_requests where id = p_id for update;
  perform app.require(m.id is not null and m.status in ('ordered', 'part_received'), 'Nothing is on order for this request');
  -- the site's receipt: the project team on site (Operations records the supplier's delivery note on the order)
  perform app.require((app.is_exec_internal(m.exec_project_id) and not app.has_role('gm', 'sm_projects', 'operations_exec')) or (by_sub and app.is_exec_member(m.exec_project_id)),
    'Only the project team on site records what was received');
  perform app.require(not exists (select 1 from public.material_receipts where mr_id = m.id and status = 'pending'), 'The last delivery is still waiting for acknowledgement');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := nullif(l ->> 'qty', '')::numeric;
    continue when coalesce(q, 0) <= 0;
    select * into ln from public.material_request_lines where id = (l ->> 'line_id')::uuid and mr_id = m.id;
    perform app.require(ln.id is not null, 'Unknown item');
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('line_id', ln.id, 'item', ln.item, 'unit', ln.unit, 'qty', q));
  end loop;
  perform app.require(jsonb_array_length(out_lines) > 0, 'Enter the quantities received');
  perform app.require(coalesce(p_custody, 'dimo') in ('dimo', 'client', 'subcontractor'), 'Choose the custody');
  perform app.require(coalesce(p_custody, 'dimo') <> 'subcontractor' or coalesce(btrim(p_company), '') <> '' or by_sub, 'Choose the subcontractor');
  if by_sub then
    sub := auth.uid();
  else
    sub := coalesce(p_supervisor, case when (select role from public.profiles where id = m.requested_by) = 'sub_supervisor' then m.requested_by end);
    perform app.require(sub is null or exists (select 1 from public.exec_members where exec_project_id = m.exec_project_id and user_id = sub and active and member_role = 'sub_supervisor'),
      'Choose a subcontractor supervisor of this project');
  end if;
  insert into public.material_receipts (mr_id, lines, note, supervisor_id, ae_ack_by, ae_ack_at, sub_ack_at, custody, custody_company)
  values (m.id, out_lines, nullif(btrim(p_note), ''), sub, case when by_sub then null else auth.uid() end, case when by_sub then null else now() end,
          case when by_sub then now() end, coalesce(p_custody, 'dimo'),
          case when coalesce(p_custody, 'dimo') = 'subcontractor' then coalesce(nullif(btrim(p_company), ''), (select company from public.profiles where id = auth.uid())) end)
  returning id into rid;
  if by_sub then
    perform app.notify_many(app.project_aes(m.exec_project_id), 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()),
      'normal', 'material_request', m.id, '/execution/material/' || m.id, null, true);
  elsif sub is not null then
    perform app.notify(sub, 'exec_material', 'Delivery to acknowledge', app.mr_head(m) || ' · recorded by ' || app.display_name(auth.uid()), 'normal', 'material_request', m.id,
      '/execution/material/' || m.id, null, true);
  else
    perform app.book_receipt(rid);  -- no subcontractor involved: the engineer's record is enough
  end if;
  if coalesce(btrim(p_note), '') <> '' then
    perform app.notify_many(app.role_users('operations_exec', 'senior_elec_engineer'), 'exec_material', 'Delivery note: damages / shortages',
      app.mr_head(m) || ' · ' || btrim(p_note), 'normal', 'material_request', m.id, '/execution/material/' || m.id);
  end if;
  return rid;
end $$;
grant execute on function public.receive_material(uuid, jsonb, text, uuid, text, text) to authenticated;

select app.fix_function_owners();
