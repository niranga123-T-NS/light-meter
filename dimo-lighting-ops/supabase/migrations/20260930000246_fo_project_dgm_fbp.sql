-- Foreign orders: the project approval is two steps – the DGM, then the FBP – each recorded with its own date.
-- "DGM + FBP approval received" becomes "Project approved by the DGM"; a new step "Project approved by the FBP" follows
-- it, and the SAP project request now follows the FBP. Import requests already past the old step get the FBP step on
-- the same date, so nothing reopens.

-- make room after the DGM step (seq is unique: move the later steps from the end)
do $$ declare d record; begin
  for d in select key from public.fo_step_defs where seq >= 32 order by seq desc loop
    update public.fo_step_defs set seq = seq + 1 where key = d.key;
  end loop;
end $$;

update public.fo_step_defs set label = 'Project approved by the DGM', node = 'DGM' where key = 'project_approved';
insert into public.fo_step_defs (key, scope, stage, seq, label, node, conds, after)
select 'project_fbp', 'h', 3, 32, 'Project approved by the FBP', 'FBP', '{}', '{project_approved}'
 where not exists (select 1 from public.fo_step_defs where key = 'project_fbp');
update public.fo_step_defs set after = array_replace(after, 'project_approved', 'project_fbp') where 'project_approved' = any(after) and key <> 'project_fbp';

insert into public.fo_steps (handover_id, order_id, step, done_on, ref, note, recorded_by, recorded_at)
select s.handover_id, null, 'project_fbp', s.done_on, s.ref, 'Recorded with the DGM approval (one step before)', s.recorded_by, s.recorded_at
  from public.fo_steps s
 where s.step = 'project_approved' and s.order_id is null
   and not exists (select 1 from public.fo_steps x where x.handover_id = s.handover_id and x.order_id is null and x.step = 'project_fbp');
