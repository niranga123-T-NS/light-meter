-- Design Tools: only the last saved revision of a design is kept. Each new revision deletes the older ones of that design,
-- and the older revisions already saved are deleted now. The history log (saves, checks, approvals) stays as the record.
create or replace function app.design_tool_keep_last_revision() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.design_tool_revisions where file_id = new.file_id and revision < new.revision;
  return null;
end $$;

create trigger design_tool_revisions_keep_last after insert on public.design_tool_revisions
  for each row execute function app.design_tool_keep_last_revision();

delete from public.design_tool_revisions r
  using (select file_id, max(revision) as last from public.design_tool_revisions group by file_id) x
  where r.file_id = x.file_id and r.revision < x.last;
