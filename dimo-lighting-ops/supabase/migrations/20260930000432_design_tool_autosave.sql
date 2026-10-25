-- Design Tools autosave: the page saves itself 15 minutes after a change, on drafts only (a save takes a checked or approved
-- design back to draft, so that stays a person's decision). Autosaves one after another by the same person update one
-- "Autosave" revision instead of adding a revision every 15 minutes. "Save as" is a new design saved from the page (p_id null).
create or replace function public.design_tool_save(p_id uuid, p_title text, p_inquiry uuid, p_state jsonb, p_summary jsonb default '{}',
  p_note text default null, p_engine text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare f public.design_tool_files; v_id uuid; changed boolean; auto boolean := btrim(coalesce(p_note, '')) = 'Autosave'; last public.design_tool_revisions;
begin
  perform app.require(app.design_tools_user(), 'Design Tools are for the GM / DGM, SM Projects and the design team');
  perform app.require(coalesce(btrim(p_title), '') <> '', 'Give the design a title');
  perform app.require(p_state is not null and jsonb_typeof(p_state) = 'object' and p_state ? 'tree', 'Nothing to save');
  if p_id is null then
    insert into public.design_tool_files (title, inquiry_id, template, state, summary, engine)
    values (btrim(p_title), p_inquiry, coalesce(p_state ->> 'tpl', 'building'), p_state, coalesce(p_summary, '{}'), p_engine)
    returning id into v_id;
    insert into public.design_tool_revisions (file_id, revision, state, summary, note) values (v_id, 1, p_state, coalesce(p_summary, '{}'), nullif(btrim(p_note), ''));
    insert into public.design_tool_log (file_id, action, revision, note) values (v_id, 'created', 1, nullif(btrim(p_note), ''));
    return v_id;
  end if;
  select * into f from public.design_tool_files where id = p_id for update;
  perform app.require(f.id is not null, 'Design not found');
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
    -- saved by hand with nothing new since the autosave: the revision becomes an ordinary one
    update public.design_tool_revisions set note = nullif(btrim(p_note), ''), saved_at = now() where id = last.id;
  end if;
  return p_id;
end $$;
