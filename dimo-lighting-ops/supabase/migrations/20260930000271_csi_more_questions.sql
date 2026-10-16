-- CSI "Light up DIMO" – a fuller survey that still takes under 2 minutes:
--  * effort: how easy DIMO is to work with (1 very hard … 5 very easy)
--  * repurchase: will they choose DIMO for the next lighting project (-2 definitely not … 2 definitely)
--  * contact_topics: what the customer wants to be contacted about (new project, maintenance, LED upgrade, controls,
--    training, spare parts) – the sales person is told at once, it is a sales lead
--  * Project execution: the stages are now inquiry, design, quotation, delivery, installation (site works & installation),
--    handover (testing, commissioning & handover) and after-sales. The Senior Electrical Engineer starts a CSI for his own
--    execution project (team = 'execution'); the project's sales person and SEE both see the surveys of their project, and
--    a request to be contacted also goes to the project's sales person.
--  * A low result now also includes "hard to work with" (effort ≤ 2) and "probably will not choose DIMO again" (repurchase ≤ -1).

alter table public.csi_surveys add column if not exists effort int check (effort between 1 and 5);
alter table public.csi_surveys add column if not exists repurchase int check (repurchase between -2 and 2);
alter table public.csi_surveys add column if not exists contact_topics text[] not null default '{}'
  check (contact_topics <@ array['new_project', 'maintenance', 'upgrade', 'controls', 'training', 'spares']);

alter table public.csi_surveys drop constraint if exists csi_surveys_stages_check;
alter table public.csi_surveys add constraint csi_surveys_stages_check check (cardinality(stages) between 1 and 7
  and stages <@ array['inquiry', 'design', 'quotation', 'delivery', 'installation', 'handover', 'after_sales']);
alter table public.csi_surveys add column if not exists team text not null default 'sales' check (team in ('sales', 'execution'));

-- who sees a survey: the person who started it, SM Projects / GM / sys admin, and the sales person and SEE of its project
drop policy if exists csi_read on public.csi_surveys;
create policy csi_read on public.csi_surveys for select to authenticated using (
  sales_person_id = auth.uid() or app.csi_manager()
  or (project_id is not null and (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
                                  or exists (select 1 from public.exec_projects e where e.project_id = csi_surveys.project_id and e.see_id = auth.uid()))));

-- Start a survey: a sales person (any customer) or the SEE of the execution project (that project's client)
-- p: {organization_id, project_id, contact_id, contact_name, contact_role, stages[], channel}
create or replace function public.csi_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; st text[] := array(select jsonb_array_elements_text(coalesce(p -> 'stages', '[]'::jsonb)));
  pid uuid := nullif(p ->> 'project_id', '')::uuid; org uuid := nullif(p ->> 'organization_id', '')::uuid; see boolean := false;
begin
  if not app.is_sales_person() then
    see := app.has_role('senior_elec_engineer') and pid is not null and exists (select 1 from public.exec_projects where project_id = pid and see_id = auth.uid());
    perform app.require(see, case when app.has_role('senior_elec_engineer') then 'Choose one of your execution projects' else 'Only sales people and the project''s SEE start a CSI' end);
    org := (select organization_id from public.projects where id = pid);
  end if;
  perform app.require(exists (select 1 from public.organizations where id = org), 'Choose the customer');
  perform app.require(coalesce(length(btrim(p ->> 'contact_name')), 0) >= 2, 'Enter the name of the person who answers');
  perform app.require(cardinality(st) >= 1, 'Choose at least one stage the customer went through');
  insert into public.csi_surveys (code, organization_id, project_id, contact_id, contact_name, contact_role, stages, channel, team)
  values (app.next_code('CSI'), org, pid, case when see then null else nullif(p ->> 'contact_id', '')::uuid end,
          btrim(p ->> 'contact_name'), nullif(btrim(p ->> 'contact_role'), ''), st, coalesce(nullif(p ->> 'channel', ''), 'link'), case when see then 'execution' else 'sales' end)
  returning id into sid;
  return sid;
end $$;
revoke all on function public.csi_create(jsonb) from public, anon;
grant execute on function public.csi_create(jsonb) to authenticated;

-- a: as before plus {effort, repurchase, contact_topics[]}
create or replace function public.csi_submit(p_token text, a jsonb, p_by text default 'customer') returns void
language plpgsql security definer set search_path = public as $$
declare s public.csi_surveys; pts jsonb := coalesce(a -> 'points', '{}'); total int; k text; v jsonb; fb text; low boolean; head text;
  topics text[] := array(select distinct jsonb_array_elements_text(coalesce(a -> 'contact_topics', '[]'::jsonb)));
  labels text;
begin
  select * into s from public.csi_surveys where token = p_token for update;
  perform app.require(s.id is not null and length(coalesce(p_token, '')) >= 40, 'This survey link is not valid');
  perform app.require(s.status = 'open', 'This survey is already completed – thank you');
  perform app.require(s.expires_at >= now(), 'This survey link has expired – please ask your DIMO contact for a new one');
  perform app.require((a ->> 'overall') ~ '^\d+$' and (a ->> 'overall')::int between 0 and 100, 'Set the overall dimmer');
  perform app.require((a ->> 'nps') ~ '^\d+$' and (a ->> 'nps')::int between 0 and 10, 'Choose how likely you are to recommend us');
  for k, v in select * from jsonb_each(coalesce(a -> 'stage_scores', '{}')) loop
    perform app.require(k = any (s.stages) and v::text ~ '^[1-5]$', 'Invalid stage score');
  end loop;
  for k, v in select * from jsonb_each(coalesce(a -> 'cards', '{}')) loop
    perform app.require(k ~ '^[a-z_]{2,30}$' and v::text in ('-1', '0', '1'), 'Invalid card answer');
  end loop;
  select coalesce(sum(value::text::int), 0) into total from jsonb_each(pts) where key in ('price', 'quality', 'speed', 'support', 'after_sales') and value::text ~ '^\d+$';
  perform app.require(total = 100 and (select count(*) from jsonb_object_keys(pts)) = 5, 'Share exactly 100 points');
  perform app.require(a ->> 'vs_others' is null or (a ->> 'vs_others') ~ '^-?[0-2]$', 'Invalid comparison');
  perform app.require(a ->> 'effort' is null or (a ->> 'effort') ~ '^[1-5]$', 'Invalid answer for how easy we are to work with');
  perform app.require(a ->> 'repurchase' is null or (a ->> 'repurchase') ~ '^-?[0-2]$', 'Invalid answer for choosing DIMO again');
  perform app.require(topics <@ array['new_project', 'maintenance', 'upgrade', 'controls', 'training', 'spares'], 'Invalid contact topic');
  fb := case when auth.uid() = s.sales_person_id and p_by = 'sales' then 'sales' else 'customer' end;
  low := (a ->> 'overall')::int < 60 or (a ->> 'nps')::int <= 6 or coalesce((a ->> 'effort')::int, 5) <= 2 or coalesce((a ->> 'repurchase')::int, 0) <= -1;
  update public.csi_surveys set status = 'completed', completed_at = now(), filled_by = fb,
         overall = (a ->> 'overall')::int, stage_scores = coalesce(a -> 'stage_scores', '{}'), cards = coalesce(a -> 'cards', '{}'), points = pts,
         vs_others = nullif(a ->> 'vs_others', '')::int, nps = (a ->> 'nps')::int,
         effort = nullif(a ->> 'effort', '')::int, repurchase = nullif(a ->> 'repurchase', '')::int, contact_topics = topics,
         reference_ok = case when (a ->> 'nps')::int >= 9 then coalesce((a ->> 'reference_ok')::boolean, false) end,
         quote_ok = case when (a ->> 'nps')::int >= 9 then coalesce((a ->> 'quote_ok')::boolean, false) end,
         wish = nullif(btrim(left(coalesce(a ->> 'wish', ''), 1000)), ''), alert = low
   where id = s.id;
  head := format('%s · %s (%s)', s.code, (select name from public.organizations where id = s.organization_id), s.contact_name);
  perform app.notify(s.sales_person_id, 'csi', case when low then 'Low CSI – call the customer within 48 hours' else 'CSI completed' end,
    format('%s · overall %s / 100 · recommend %s / 10', head, a ->> 'overall', a ->> 'nps'), case when low then 'critical' else 'normal' end::public.priority,
    'csi', s.id, '/csi/' || s.id);
  if low then
    perform app.notify_many(app.role_users('sm_projects'), 'csi', 'Low customer satisfaction',
      format('%s · overall %s / 100 · recommend %s / 10 – the sales person calls within 48 hours', head, a ->> 'overall', a ->> 'nps'),
      'critical', 'csi', s.id, '/csi/' || s.id);
  end if;
  if (a ->> 'nps')::int >= 9 and coalesce((a ->> 'reference_ok')::boolean, false) then
    perform app.notify_many(app.role_users('lighting_designer'), 'csi', 'Customer agreed to be a project reference',
      head || coalesce(' · ' || (select name from public.projects where id = s.project_id), '') || ' – add it to References', 'normal', 'csi', s.id, '/csi/' || s.id);
  end if;
  -- a sales lead: the customer asked to be contacted
  if cardinality(topics) > 0 then
    select string_agg(case t when 'new_project' then 'a new project' when 'maintenance' then 'maintenance & service' when 'upgrade' then 'an energy-saving LED upgrade'
      when 'controls' then 'lighting controls' when 'training' then 'training' else 'spare parts' end, ', ') into labels from unnest(topics) t;
    perform app.notify_many(array(select distinct x from unnest(array[s.sales_person_id, (select owner_id from public.projects where id = s.project_id)]) x where x is not null),
      'csi', 'Customer asks to be contacted', format('%s – about %s', head, labels), 'normal', 'csi', s.id, '/csi/' || s.id);
  end if;
end $$;
revoke all on function public.csi_submit(text, jsonb, text) from public;
grant execute on function public.csi_submit(text, jsonb, text) to anon, authenticated;

select app.fix_function_owners();
