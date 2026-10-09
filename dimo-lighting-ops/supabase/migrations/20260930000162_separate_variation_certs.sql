-- Variations are submitted separately from the BOQ work at every stage: a joint-measurement request for a cycle creates one
-- certificate for the BOQ (contract) work and one for each approved variation chosen, each going through its own joint
-- measurement, IPA and IPC / invoice. (Replaces ticking variations inside the BOQ certificate.)

alter table public.sub_certs add column if not exists variation_id uuid references public.variations (id);
alter table public.sub_certs add column if not exists var_code text;
alter table public.sub_certs add column if not exists var_title text;

-- Approved variations of the project a measurement can be requested for
create or replace function public.sub_variation_options(p_exec uuid)
returns table (id uuid, code text, vo_no text, title text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_record_sub_invoice(p_exec) or app.can_read_exec(p_exec), 'Not allowed');
  return query select v.id, v.code, v.vo_no, v.title from public.variations v
    where v.exec_project_id = p_exec and v.status in ('approved', 'client_accepted') order by v.code;
end $$;

create or replace function public.prepare_sub_cert(p_exec uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; c public.sub_certs; v public.variations;
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'The project''s subcontractor supervisor or Assistant Engineer requests the joint measurement');
  perform app.require(coalesce(btrim(p ->> 'subcontractor'), '') <> '' and coalesce(btrim(p ->> 'period'), '') <> '', 'Enter the subcontractor and the period');
  perform app.require(nullif(p ->> 'jm_date', '') is not null, 'Enter the proposed date for the joint measurement');
  if nullif(p ->> 'variation_id', '') is not null then
    select * into v from public.variations where id = (p ->> 'variation_id')::uuid;
    perform app.require(v.id is not null and v.exec_project_id = p_exec and v.status in ('approved', 'client_accepted'), 'Only approved variations of this project');
  end if;
  insert into public.sub_certs (code, exec_project_id, subcontractor, period, gross, previous, retention_pct, deductions, note, status, jm_requested_date, jm_scope, variation_id, var_code, var_title)
  values (app.next_code('SPC'), p_exec, btrim(p ->> 'subcontractor'), btrim(p ->> 'period'), coalesce(nullif(replace(p ->> 'gross', ',', ''), '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'previous', ',', ''), '')::numeric, 0), coalesce(nullif(p ->> 'retention_pct', '')::numeric, 0),
          coalesce(nullif(replace(p ->> 'deductions', ',', ''), '')::numeric, 0), nullif(btrim(p ->> 'note'), ''), 'jm_requested',
          (p ->> 'jm_date')::date, nullif(btrim(p ->> 'jm_scope'), ''), v.id, coalesce(nullif(v.vo_no, ''), v.code), v.title)
  returning * into c;
  perform app.notify_many(array(select unnest(app.project_aes(p_exec)) union select unnest(app.role_users('senior_elec_engineer'))), 'exec_cost',
    'Joint measurement requested', format('%s · %s · %s · %s · proposed %s%s · %s', c.code, coalesce('Variation ' || c.var_code, 'BOQ work'), c.subcontractor, c.period, to_char(c.jm_requested_date, 'DD Mon YYYY'),
      coalesce(' · ' || c.jm_scope, ''), app.exec_head(p_exec)), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  return c.id;
end $$;

-- One request per cycle: the BOQ work and / or each chosen variation become separate certificates
create or replace function public.request_joint_measurements(p_exec uuid, p jsonb) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare ids uuid[] := '{}'; vid text; boq boolean := coalesce((p ->> 'boq')::boolean, true);
begin
  perform app.require(boq or jsonb_array_length(coalesce(p -> 'variation_ids', '[]')) > 0, 'Choose the BOQ work and / or the variations to measure');
  if boq then ids := ids || public.prepare_sub_cert(p_exec, (p - 'variation_ids') - 'variation_id'); end if;
  for vid in select jsonb_array_elements_text(coalesce(p -> 'variation_ids', '[]')) loop
    ids := ids || public.prepare_sub_cert(p_exec, (p - 'variation_ids') || jsonb_build_object('variation_id', vid));
  end loop;
  return ids;
end $$;

create or replace function public.set_sub_cert_variations(p_cert uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs;
begin
  perform app.require(false, 'Variations are now submitted separately – request a joint measurement for the variation');
  select * into c from public.sub_certs where id = p_cert for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Only a draft or returned certificate can be changed');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it changes it');
  p_ids := coalesce(p_ids, '{}');
  perform app.require(not exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.variations v where v.id = i
    and v.exec_project_id = c.exec_project_id and v.status in ('approved', 'client_accepted'))), 'Only approved variations of this project');
  delete from public.attachments a using public.sub_cert_variations x
   where x.sub_cert_id = c.id and not (x.variation_id = any (p_ids)) and a.entity_type = 'sub_cert_var' and a.entity_id = x.id;
  delete from public.sub_cert_variations where sub_cert_id = c.id and not (variation_id = any (p_ids));
  insert into public.sub_cert_variations (sub_cert_id, variation_id, var_code, var_title)
  select c.id, v.id, coalesce(nullif(v.vo_no, ''), v.code), v.title from public.variations v where v.id = any (p_ids)
  on conflict (sub_cert_id, variation_id) do nothing;
end $$;

drop function if exists public.sub_invoice_certs(uuid);
create or replace function public.sub_invoice_certs(p_exec uuid)
returns table (id uuid, code text, subcontractor text, period text, net numeric, status text, var_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.can_record_sub_invoice(p_exec), 'Not allowed');
  return query select c.id, c.code, c.subcontractor, c.period, c.net, c.status, c.var_code from public.sub_certs c
    where c.exec_project_id = p_exec and c.status in ('verified', 'approved', 'paid') order by c.prepared_at desc;
end $$;
revoke execute on function public.sub_invoice_certs(uuid) from public, anon;
grant execute on function public.sub_invoice_certs(uuid) to authenticated, service_role;

revoke execute on function public.sub_variation_options(uuid), public.request_joint_measurements(uuid, jsonb) from public, anon;
grant execute on function public.sub_variation_options(uuid), public.request_joint_measurements(uuid, jsonb) to authenticated, service_role;
