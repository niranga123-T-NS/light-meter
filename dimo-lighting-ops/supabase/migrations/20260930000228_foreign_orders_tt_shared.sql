-- Foreign orders (TESTING): after the bank sends the TT, Procurement shares the transmitted TT with the manufacturer; manufacturing
-- (or the service) follows that step. Orders already past it get the step on the TT date, noted as recorded together.

insert into public.fo_step_defs (key, scope, stage, seq, label, node, conds, after, ref_label) values
  ('tt_shared', 'o', 5, 57, 'Transmitted TT shared with the manufacturer', 'Procurement', '{tt}', '{tt_sent}', null)
on conflict (key) do nothing;
update public.fo_step_defs set after = '{po_ack,tt_shared,lc_final}' where key in ('mfg_done', 'service_done');

insert into public.fo_steps (handover_id, order_id, step, done_on, note, recorded_by, recorded_at)
select s.handover_id, s.order_id, 'tt_shared', s.done_on, 'Recorded with the TT (before this step was added)', s.recorded_by, s.recorded_at
  from public.fo_steps s
 where s.step = 'tt_sent'
   and exists (select 1 from public.fo_steps x where x.order_id = s.order_id and x.step in ('mfg_done', 'service_done'))
on conflict do nothing;
