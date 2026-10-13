-- Foreign orders (TESTING): the import order approval is recorded person by person – DGM, then FBP, then DIC.
-- "io_approved" stays the final (DIC) approval, so the steps after it are unchanged. Orders already approved get the DGM and
-- FBP approvals on the same date, noted as recorded together.

update public.fo_step_defs set seq = 46 where key = 'io_handed';
update public.fo_step_defs set seq = 44, label = 'Import order approved by DIC', node = 'DIC', after = '{io_fbp}' where key = 'io_approved';
insert into public.fo_step_defs (key, scope, stage, seq, label, node, conds, after, ref_label) values
  ('io_dgm', 'o', 4, 41, 'Import order approved by DGM', 'DGM', '{}', '{io_created}', null),
  ('io_fbp', 'o', 4, 43, 'Import order approved by FBP', 'FBP', '{}', '{io_dgm}', null)
on conflict (key) do nothing;

insert into public.fo_steps (handover_id, order_id, step, done_on, note, recorded_by, recorded_at)
select s.handover_id, s.order_id, k, s.done_on, 'Recorded together with the DIC approval (before approvals were recorded one by one)', s.recorded_by, s.recorded_at
  from public.fo_steps s cross join unnest(array['io_dgm', 'io_fbp']) k
 where s.step = 'io_approved'
on conflict do nothing;
