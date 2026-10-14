-- Subcontractor IPCs of a project with a local service order paid by IPC: the money side is recorded once, on the local
-- order. The certificate stops at "IPC approved" (no SM Projects approval or payment on it), the invoice needs no separate
-- Operations approval (approved by the SEE → the subcontractor brings the documents, Operations takes it with + IPC); the
-- local order's approvals and payment show on the invoice and the certificate (Paid when the IPC invoice is paid).
-- Projects without such an order keep the certificate's SM Projects approval and payment as before.

create or replace function app.exec_pays_by_lo(p_exec uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lo_orders o join public.lo_requests r on r.id = o.request_id
                  where r.exec_project_id = p_exec and o.kind = 'service' and o.billing = 'ipc' and o.status <> 'cancelled')
$$;

/** The execution projects that pay their subcontractor IPCs through a local order (for the lists) */
create or replace function public.exec_projects_paid_by_lo() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct r.exec_project_id from public.lo_orders o join public.lo_requests r on r.id = o.request_id
   where r.exec_project_id is not null and o.kind = 'service' and o.billing = 'ipc' and o.status <> 'cancelled'
$$;
grant execute on function public.exec_projects_paid_by_lo() to authenticated;

alter table public.sub_invoices add column if not exists lo_invoice_id uuid references public.lo_invoices (id) on delete set null;
alter table public.sub_invoices add column if not exists lo_next text;
alter table public.sub_invoices add column if not exists lo_paid_on date;

-- the local order's progress back on the subcontractor invoice and its certificate
create or replace function app.lo_sub_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare nxt text; o public.lo_orders; ref text;
begin
  if current_setting('app.purging', true) = 'on' or new.sub_invoice_id is null then return new; end if;
  if new.status = 'cancelled' then
    update public.sub_invoices set lo_invoice_id = null, lo_next = null, lo_paid_on = null where id = new.sub_invoice_id and lo_invoice_id = new.id;
    update public.sub_certs c set status = 'verified', paid_ref = null, paid_at = null
      from public.sub_invoices v where v.id = new.sub_invoice_id and c.id = v.sub_cert_id and c.status = 'paid' and c.paid_ref like 'Local order %';
    return new;
  end if;
  select p into nxt from unnest(app.lo_invoice_chain(new.order_id)) with ordinality t(p, n)
   where (to_jsonb(new) ->> (p || '_on')) is null order by n limit 1;
  update public.sub_invoices set lo_invoice_id = new.id, lo_next = case when new.status = 'paid' then 'paid' else nxt end, lo_paid_on = new.paid_on
   where id = new.sub_invoice_id;
  select * into o from public.lo_orders where id = new.order_id;
  ref := format('Local order %s%s', o.code, coalesce(' · ' || new.pay_ref, ''));
  if new.status = 'paid' then
    update public.sub_certs c set status = 'paid', paid_ref = ref, paid_at = coalesce(new.paid_on::timestamptz, now())
      from public.sub_invoices v where v.id = new.sub_invoice_id and c.id = v.sub_cert_id and c.status in ('verified', 'approved');
  else
    update public.sub_certs c set status = 'verified', paid_ref = null, paid_at = null
      from public.sub_invoices v where v.id = new.sub_invoice_id and c.id = v.sub_cert_id and c.status = 'paid' and c.paid_ref like 'Local order %';
  end if;
  return new;
end $$;
drop trigger if exists lo_sub_sync on public.lo_invoices;
create trigger lo_sub_sync after insert or update on public.lo_invoices for each row execute function app.lo_sub_sync();

create or replace function public.decide_sub_invoice(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v public.sub_invoices; nxt text; head text;
begin
  select * into v from public.sub_invoices where id = p_id for update;
  perform app.require(v.id is not null, 'Invoice not found');
  perform app.require(p_ok or coalesce(btrim(p_note), '') <> '', 'Give the reason – and mark the comments on the copy');
  head := format('%s · %s · invoice %s · %s', v.code, v.subcontractor, v.invoice_no, app.fmt_money(v.amount, 'LKR'));
  if v.status = 'ae_review' then
    perform app.require(app.is_project_ae(v.exec_project_id), 'The project''s Assistant Engineer checks it first');
    if p_ok then
      update public.sub_invoices set status = 'submitted', ae_by = auth.uid(), ae_at = now() where id = v.id;
      perform app.notify_many(app.role_users('senior_elec_engineer'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · checked by ' || app.display_name(auth.uid()),
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'submitted';
    end if;
  elsif v.status = 'submitted' then
    perform app.require(app.has_role('senior_elec_engineer'), 'The Senior Electrical Engineer approves first');
    if p_ok and app.exec_pays_by_lo(v.exec_project_id) then
      -- paid through the project's local service order: no separate Operations approval – the approvals and the payment
      -- are recorded once, on the local order (+ IPC)
      update public.sub_invoices set status = 'approved', see_by = auth.uid(), see_at = now() where id = v.id;
      perform app.notify(v.created_by, 'sub_invoice', 'Approved – submit the physical documents',
        head || E'\nApproved by the Senior Electrical Engineer. Submit the original invoice with the IPC and measurement sheets to the DIMO Lighting Solutions office for processing.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      perform app.notify_many(app.role_users('operations_exec'), 'sub_invoice', 'Approved IPC – take it on the local order', head || ' · approved by the SEE · + IPC on the project''s local service order',
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'approved';
    elsif p_ok then
      update public.sub_invoices set status = 'see_approved', see_by = auth.uid(), see_at = now() where id = v.id;
      perform app.notify_many(app.role_users('operations_exec'), 'sub_invoice', 'Subcontractor invoice to approve', head || ' · approved by the SEE',
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'see_approved';
    end if;
  elsif v.status = 'see_approved' then
    perform app.require(app.has_role('operations_exec'), 'The Operations Executive approves');
    if p_ok then
      update public.sub_invoices set status = 'approved', ops_by = auth.uid(), ops_at = now() where id = v.id;
      perform app.notify(v.created_by, 'sub_invoice', 'Approved – submit the physical documents',
        head || E'\nApproved by the Senior Electrical Engineer and Operations. Submit the original invoice with the IPC and measurement sheets to the DIMO Lighting Solutions office for processing.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
      nxt := 'approved';
    end if;
  else
    perform app.require(false, 'Not waiting for approval');
  end if;
  if not p_ok then
    update public.sub_invoices set status = 'returned', returned_by = auth.uid(), returned_at = now(), return_note = btrim(p_note) where id = v.id;
    perform app.notify(v.created_by, 'sub_invoice', 'Invoice returned with comments',
      head || E'\n' || btrim(p_note) || E'\nSee the comments marked in red on the copy, correct and submit again. Do not send the physical documents yet.',
      'normal', 'sub_invoice', v.id, '/execution/sub-invoice/' || v.id, null, true);
    nxt := 'returned';
  end if;
  insert into public.sub_invoice_log (invoice_id, action, note) values (v.id, case when p_ok then 'approved_' || nxt else 'returned' end, nullif(btrim(p_note), ''));
  return nxt;
end $$;

create or replace function public.advance_sub_cert(p_id uuid, p_ok boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare c public.sub_certs; nxt text; head text;
begin
  select * into c from public.sub_certs where id = p_id for update;
  perform app.require(c.id is not null, 'Not found');
  perform app.require(c.status not like 'jm\_%', 'The joint measurement comes first');
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
      -- IPA given: it becomes the IPC – the SEE's final comments / edits stay with it, earlier review mark-ups are removed
      update public.attachments set archived_at = now() where entity_type = 'sub_cert' and entity_id = c.id and kind = 'ipc_markup' and archived_at is null
        and (uploaded_by is distinct from auth.uid() or uploaded_at < coalesce(c.submitted_at, c.prepared_at));
      perform app.notify(c.prepared_by, 'exec_cost', 'IPC approved – submit your invoice',
        head || E'\nInterim Payment Approval (IPA) given by the Senior Electrical Engineer – it is now the approved IPC (with the SEE''s comments / edits). Submit your invoice according to this IPC.'
          || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''),
        'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
      -- paid through the project's local service order: SM Projects approves the IPC invoice there (once)
      if not app.exec_pays_by_lo(c.exec_project_id) then
        perform app.notify_many(app.role_users('sm_projects'), 'exec_cost', 'Subcontractor payment certificate to approve', head || ' · ' || app.exec_head(c.exec_project_id),
          'normal', 'sub_cert', c.id, '/execution/sub-cert/' || c.id, null, true);
      end if;
    end if;
  elsif c.status = 'verified' then
    perform app.require(not app.exec_pays_by_lo(c.exec_project_id),
      'Paid through the project''s local service order – SM Projects approves and Operations records the payment on the IPC invoice there');
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

select app.purge_guard_triggers();
select app.fix_function_owners();
