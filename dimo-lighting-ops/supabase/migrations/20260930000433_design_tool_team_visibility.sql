-- Design Tools: a design belongs to the team of the person who started it. The design team (Design Manager, lighting designers
-- and engineers) sees only the design team's designs, the execution team (SEE, Assistant Engineers) only the execution team's;
-- the person who started a design always sees it; SM Projects and the DGM see every design. The check step follows the team:
-- the Design Manager checks design team designs, the SEE checks execution team designs, and a design started by SM Projects or
-- the DGM is checked by the other of them. SM Projects or the DGM approve.
create or replace function app.design_tool_team(p_role public.app_role) returns text
language sql immutable as $$
  select case when p_role in ('design_manager', 'lighting_designer', 'lighting_engineer') then 'design'
              when p_role in ('senior_elec_engineer', 'assistant_engineer') then 'execution'
              else 'management' end
$$;

alter table public.design_tool_files add column team text check (team in ('design', 'execution', 'management'));
update public.design_tool_files f set team = app.design_tool_team(p.role) from public.profiles p where p.id = f.created_by;
update public.design_tool_files set team = 'design' where team is null;
alter table public.design_tool_files alter column team set not null;

/** Can the signed-in person see a design of this team, started by this person */
create or replace function app.design_tool_sees(p_team text, p_created_by uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.design_tools_user() and exists (select 1 from public.profiles where id = auth.uid()
    and (role in ('gm', 'sm_projects') or id = p_created_by or app.design_tool_team(role) = p_team))
$$;

/** Who checks a design of this team */
create or replace function app.design_tool_checkers(p_team text) returns public.app_role[]
language sql immutable as $$
  select case p_team when 'design' then array['design_manager']::public.app_role[]
                     when 'execution' then array['senior_elec_engineer']::public.app_role[]
                     else array['sm_projects', 'gm']::public.app_role[] end
$$;

drop policy design_tool_files_read on public.design_tool_files;
create policy design_tool_files_read on public.design_tool_files for select to authenticated using (app.design_tool_sees(team, created_by));
drop policy design_tool_revisions_read on public.design_tool_revisions;
create policy design_tool_revisions_read on public.design_tool_revisions for select to authenticated
  using (exists (select 1 from public.design_tool_files f where f.id = file_id));
drop policy design_tool_log_read on public.design_tool_log;
create policy design_tool_log_read on public.design_tool_log for select to authenticated
  using (exists (select 1 from public.design_tool_files f where f.id = file_id));

create or replace function public.design_tool_save(p_id uuid, p_title text, p_inquiry uuid, p_state jsonb, p_summary jsonb default '{}',
  p_note text default null, p_engine text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.design_tool_files; v_id uuid; changed boolean; auto boolean := btrim(coalesce(p_note, '')) = 'Autosave'; last public.design_tool_revisions;
begin
  perform app.require(app.design_tools_user(), 'Design Tools are for the DGM, SM Projects, the design team and the project engineers');
  perform app.require(coalesce(btrim(p_title), '') <> '', 'Give the design a title');
  perform app.require(p_state is not null and jsonb_typeof(p_state) = 'object' and p_state ? 'tree', 'Nothing to save');
  if p_id is null then
    insert into public.design_tool_files (title, inquiry_id, template, state, summary, engine, team)
    values (btrim(p_title), p_inquiry, coalesce(p_state ->> 'tpl', 'building'), p_state, coalesce(p_summary, '{}'), p_engine, app.design_tool_team(app.my_role()))
    returning id into v_id;
    insert into public.design_tool_revisions (file_id, revision, state, summary, note) values (v_id, 1, p_state, coalesce(p_summary, '{}'), nullif(btrim(p_note), ''));
    insert into public.design_tool_log (file_id, action, revision, note) values (v_id, 'created', 1, nullif(btrim(p_note), ''));
    return v_id;
  end if;
  select * into f from public.design_tool_files where id = p_id for update;
  perform app.require(f.id is not null and app.design_tool_sees(f.team, f.created_by), 'Design not found');
  perform app.require(not f.archived, 'This design is archived – restore it first');
  perform app.require(not auto or f.status = 'draft', 'Autosave is for drafts only – save it yourself to make a new revision');
  changed := f.state is distinct from p_state;
  select * into last from public.design_tool_revisions where file_id = p_id and revision = f.revision;
  -- another autosave on top of this person's autosave: the same revision is brought up to date
  if auto and changed and last.note = 'Autosave' and last.saved_by = auth.uid() then
    update public.design_tool_revisions set state = p_state, summary = coalesce(p_summary, '{}'), saved_at = now() where id = last.id;
    update public.design_tool_files set title = btrim(p_title), inquiry_id = p_inquiry, state = p_state, summary = coalesce(p_summary, summary),
      template = coalesce(p_state ->> 'tpl', template), engine = coalesce(p_engine, engine), updated_by = auth.uid(), updated_at = now()
    where id = p_id;
    return p_id;
  end if;
  update public.design_tool_files set title = btrim(p_title), inquiry_id = p_inquiry,
    state = p_state, summary = coalesce(p_summary, summary), template = coalesce(p_state ->> 'tpl', template), engine = coalesce(p_engine, engine),
    revision = revision + case when changed then 1 else 0 end,
    status = case when changed then 'draft' else status end,
    checked_by = case when changed then null else checked_by end, checked_at = case when changed then null else checked_at end,
    approved_by = case when changed then null else approved_by end, approved_at = case when changed then null else approved_at end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into f;
  if changed then
    insert into public.design_tool_revisions (file_id, revision, state, summary, note) values (p_id, f.revision, p_state, coalesce(p_summary, '{}'), nullif(btrim(p_note), ''));
    insert into public.design_tool_log (file_id, action, revision, note) values (p_id, 'saved', f.revision, nullif(btrim(p_note), ''));
  elsif not auto and last.note = 'Autosave' then
    update public.design_tool_revisions set note = nullif(btrim(p_note), ''), saved_at = now() where id = last.id;
  end if;
  return p_id;
end $$;

create or replace function public.design_tool_decide(p_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare f public.design_tool_files; v_role public.app_role; chk public.app_role[];
begin
  perform app.require(app.design_tools_user(), 'Design Tools are for the DGM, SM Projects, the design team and the project engineers');
  select * into f from public.design_tool_files where id = p_id for update;
  perform app.require(f.id is not null and not f.archived and app.design_tool_sees(f.team, f.created_by), 'Design not found');
  select role into v_role from public.profiles where id = auth.uid();
  chk := app.design_tool_checkers(f.team);
  if p_action = 'submit' then
    perform app.require(f.status = 'draft', 'Only a draft is sent for checking');
    update public.design_tool_files set status = 'for_check' where id = p_id;
    perform app.notify_many(array(select x from unnest(app.role_users(variadic chk)) x where x <> auth.uid()), 'design_tool', 'Design to check',
      f.title || ' · rev ' || f.revision, 'normal', 'design_tool', p_id, '/design-tools/' || p_id);
  elsif p_action = 'check' then
    perform app.require(f.status = 'for_check', 'This design is not waiting for a check');
    perform app.require(v_role = any (chk), case f.team when 'design' then 'The Design Manager checks design team designs'
      when 'execution' then 'The SEE checks execution team designs' else 'SM Projects or the DGM checks this design' end);
    perform app.require(f.updated_by is distinct from auth.uid(), 'Someone other than the person who saved this revision checks it');
    update public.design_tool_files set status = 'checked', checked_by = auth.uid(), checked_at = now() where id = p_id;
    perform app.notify_many(array(select x from unnest(app.role_users('sm_projects')) x where x <> auth.uid()), 'design_tool', 'Design to approve',
      f.title || ' · rev ' || f.revision, 'normal', 'design_tool', p_id, '/design-tools/' || p_id);
  elsif p_action = 'approve' then
    perform app.require(f.status = 'checked', 'It is checked first');
    perform app.require(v_role in ('sm_projects', 'gm'), 'SM Projects or the DGM approves');
    update public.design_tool_files set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
    perform app.notify_many(array(select distinct x from unnest(array[f.created_by, f.updated_by]) x where x is not null and x <> auth.uid()), 'design_tool', 'Design approved',
      f.title || ' · rev ' || f.revision, 'normal', 'design_tool', p_id, '/design-tools/' || p_id);
  elsif p_action = 'return' then
    perform app.require(f.status in ('for_check', 'checked', 'approved'), 'It is already a draft');
    perform app.require(v_role = any (chk) or v_role in ('sm_projects', 'gm'), 'The checker of this design, SM Projects or the DGM returns it');
    perform app.require(coalesce(btrim(p_note), '') <> '', 'Say what needs to change');
    update public.design_tool_files set status = 'draft', checked_by = null, checked_at = null, approved_by = null, approved_at = null where id = p_id;
    perform app.notify_many(array(select distinct x from unnest(array[f.created_by, f.updated_by]) x where x is not null and x <> auth.uid()), 'design_tool', 'Design returned',
      f.title || ' · ' || btrim(p_note), 'normal', 'design_tool', p_id, '/design-tools/' || p_id);
  else
    perform app.require(false, 'Unknown action');
  end if;
  insert into public.design_tool_log (file_id, action, revision, note) values (p_id, p_action, f.revision, nullif(btrim(p_note), ''));
end $$;

create or replace function public.design_tool_archive(p_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f public.design_tool_files;
begin
  perform app.require(app.design_tools_user(), 'Design Tools are for the DGM, SM Projects, the design team and the project engineers');
  select * into f from public.design_tool_files where id = p_id for update;
  perform app.require(f.id is not null and app.design_tool_sees(f.team, f.created_by), 'Design not found');
  perform app.require(f.created_by = auth.uid() or app.my_role() = any (app.design_tool_checkers(f.team)) or app.my_role() in ('sm_projects', 'gm'),
    'The person who started it, the checker of its team, SM Projects or the DGM');
  update public.design_tool_files set archived = p_archived, updated_at = now() where id = p_id;
  insert into public.design_tool_log (file_id, action, revision) values (p_id, case when p_archived then 'archived' else 'restored' end, f.revision);
end $$;
