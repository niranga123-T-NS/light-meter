-- Wording: the SEE's approval of a subcontractor IPC is the Interim Payment Approval (IPA). Until it is given the IPC shows
-- "IPA pending"; the invoice, signed IPC and final measurement sheets can only be uploaded after IPA.

create or replace function public.advance_sub_cert(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  if c.status in ('draft', 'returned') then
    return public.submit_sub_cert(c.id);
  end if;
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · %s · net %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'));
  if c.status = 'ae_review' then
    perform app.require(app.is_project_ae(c.exec_project_id), 'The project''s Assistant Engineer checks it first');
    nxt := case when p_ok then 'prepared' else 'returned' end;
    update public.sub_certs set status = nxt, ae_by = auth.uid(), ae_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC – IPA pending',
      head || ' · checked by ' || app.display_name(auth.uid()) || ' · ' || app.exec_head(c.exec_project_id), 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true); end if;
  elsif c.status = 'prepared' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves');
    nxt := case when p_ok then 'verified' else 'returned' end;
    update public.sub_certs set status = nxt, verified_by = auth.uid(), verified_at = now() where id = c.id;
    if p_ok then
      perform app.notify(c.prepared_by, 'exec_cost', 'IPA approved – record the invoice',
        head || E'\nInterim Payment Approval (IPA) given by the Senior Electrical Engineer. Now record the subcontractor invoice with the IPA-approved IPC with signatures and the corrected (final) measurement sheets.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
      perform app.notify_many(app.role_users('sm_projects'), 'exec_cost', 'Subcontractor payment certificate to approve', head || ' · ' || app.exec_head(c.exec_project_id),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
    end if;
  elsif c.status = 'verified' then
    perform app.require(app.has_role('sm_projects'), 'SM Projects approves');
    nxt := case when p_ok then 'approved' else 'returned' end;
    update public.sub_certs set status = nxt, approved_by = auth.uid(), approved_at = now() where id = c.id;
    if p_ok then perform app.notify_many(app.role_users('operations_exec'), 'exec_cost', 'Subcontractor payment approved – process the payment', head,
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id); end if;
  elsif c.status = 'approved' then
    perform app.require(app.has_role('operations_exec'), 'Operations records the payment');
    perform app.require(p_ok and coalesce(btrim(p_note), '') <> '', 'Enter the payment reference');
    nxt := 'paid';
    update public.sub_certs set status = 'paid', paid_ref = btrim(p_note), paid_at = now() where id = c.id;
  else
    perform app.require(false, case c.status when 'paid' then 'Already paid' else 'Withdrawn' end);
  end if;
  if not p_ok then
    update public.sub_certs set returned_by = auth.uid(), return_note = btrim(p_note) where id = c.id;
    perform app.notify(c.prepared_by, 'exec_cost', 'IPC returned with comments', head || E'\n' || btrim(p_note) || E'\nSee the marked-up copy, correct and submit again.',
      'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return nxt;
end $$;

create or replace function public.submit_sub_cert(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; aes uuid[]; by_sub boolean; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(c.prepared_by = auth.uid() or app.has_role('senior_elec_engineer'), 'Only who prepared it submits it');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_draft'),
    'Attach the IPC (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_cert' and a.entity_id = c.id and a.kind = 'ipc_measure'),
    'Attach the measurement sheets (PDF or photos)');
  -- prepared by a subcontractor supervisor: the project's Assistant Engineer checks it first (if the project has one)
  by_sub := exists (select 1 from public.profiles where id = c.prepared_by and role = 'sub_supervisor');
  aes := array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = c.exec_project_id and m.member_role = 'assistant_engineer' and m.active and p.active);
  update public.sub_certs set status = case when by_sub and cardinality(aes) > 0 then 'ae_review' else 'prepared' end, submitted_at = now(),
    revision = revision + case when status = 'returned' then 1 else 0 end, return_note = null
  where id = c.id returning * into c;
  head := format('%s · %s · %s · net %s · %s', c.code, c.subcontractor, c.period, app.fmt_money(c.net, 'LKR'), app.exec_head(c.exec_project_id));
  if c.status = 'ae_review' then
    perform app.notify_many(aes, 'exec_cost', 'Subcontractor IPC to check', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'exec_cost', 'Subcontractor IPC – IPA pending', head, 'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
  end if;
  return c.status;
end $$;

create or replace function public.create_sub_invoice(p_cert uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; iid uuid;
begin
  select * into c from public.sub_certs where id = p_cert;
  perform app.require(c.id is not null, 'Payment certificate not found');
  perform app.require(app.can_record_sub_invoice(c.exec_project_id), 'Only the project''s subcontractor supervisor or Assistant Engineer records invoices');
  perform app.require(c.status in ('verified', 'approved', 'paid'), 'The payment certificate (IPC and measurement sheets) must have Interim Payment Approval (IPA) first – IPA pending');
  perform app.require(coalesce(btrim(p ->> 'invoice_no'), '') <> '', 'Enter the invoice number');
  perform app.require(nullif(p ->> 'invoice_date', '') is not null, 'Enter the invoice date');
  perform app.require(coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, 0) > 0, 'Enter the invoice amount');
  insert into public.sub_invoices (code, exec_project_id, sub_cert_id, subcontractor, invoice_no, invoice_date, amount, note)
  values (app.next_code('SINV'), c.exec_project_id, c.id, c.subcontractor, btrim(p ->> 'invoice_no'), (p ->> 'invoice_date')::date,
          replace(p ->> 'amount', ',', '')::numeric, nullif(btrim(p ->> 'note'), ''))
  returning id into iid;
  insert into public.sub_invoice_log (invoice_id, action) values (iid, 'created');
  return iid;
end $$;

create or replace function public.submit_sub_invoice(p_id uuid, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices; head text; aes uuid[]; by_sub boolean;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null, 'Invoice not found');
  -- recorded by a subcontractor supervisor: the project's Assistant Engineer checks it first (if the project has one)
  by_sub := exists (select 1 from public.profiles where id = v.created_by and role = 'sub_supervisor');
  aes := array(select m.user_id from public.exec_members m join public.profiles p on p.id = m.user_id
                where m.exec_project_id = v.exec_project_id and m.member_role = 'assistant_engineer' and m.active and p.active);
  perform app.require(v.created_by = auth.uid() or (app.can_record_sub_invoice(v.exec_project_id) and not app.has_role('sub_supervisor')), 'Only who recorded it submits it');
  perform app.require(v.status in ('draft', 'returned'), 'Already submitted');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'sinv_doc'),
    'Attach the invoice copy (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'ipc_signed'),
    'Attach the IPA-approved IPC with signatures (PDF or photos)');
  perform app.require(exists (select 1 from public.attachments a where a.entity_type = 'sub_invoice' and a.entity_id = v.id and a.kind = 'measure_final'),
    'Attach the corrected (final) measurement sheets (PDF or photos)');
  update public.sub_invoices set status = case when by_sub and cardinality(aes) > 0 then 'ae_review' else 'submitted' end, submitted_at = now(), revision = revision + case when status = 'returned' then 1 else 0 end,
    invoice_no = coalesce(nullif(btrim(p ->> 'invoice_no'), ''), invoice_no), amount = coalesce(nullif(replace(p ->> 'amount', ',', ''), '')::numeric, amount),
    note = coalesce(nullif(btrim(p ->> 'note'), ''), note)
   where id = v.id returning * into v;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, case when v.revision > 0 then 'resubmitted' else 'submitted' end, nullif(btrim(p ->> 'note'), ''));
  head := format('%s · %s · invoice %s · %s', v.code, v.subcontractor, v.invoice_no, app.fmt_money(v.amount, 'LKR'));
  perform app.notify(v.created_by, 'sub_invoice', 'Invoice recorded – for reference only',
    head || E'\nThis submission is for recording purposes only. The physical documents must be submitted to the DIMO Lighting Solutions office for processing – you will be told here when they can be submitted (after the Senior Electrical Engineer and Operations approve).',
    'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  if v.status = 'ae_review' then
    perform app.notify_many(aes, 'sub_invoice', 'Subcontractor invoice to check', head || ' · ' || app.exec_head(v.exec_project_id),
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  else
    perform app.notify_many(app.role_users('senior_elec_engineer'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · ' || app.exec_head(v.exec_project_id),
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
  end if;
end $$;
