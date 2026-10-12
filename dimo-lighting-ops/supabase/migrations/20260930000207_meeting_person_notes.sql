-- Meeting notes per person: each sales person's (team member's) discussion holds any number of separate notes,
-- each with its own actions – as the general meeting notes. The earlier single discussion text stays as it is.

alter table public.meeting_items add column if not exists sales_person_id uuid references public.profiles (id);

drop function if exists public.save_meeting_item(uuid, uuid, text);
create or replace function public.save_meeting_item(p_meeting uuid, p_id uuid, p_body text, p_sales_person uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.sales_meetings := app.meeting_for_edit(p_meeting); iid uuid := p_id;
begin
  perform app.require(coalesce(btrim(p_body), '') <> '', 'Write the note');
  perform app.require(p_sales_person is null or exists (select 1 from public.profiles where id = p_sales_person), 'Person not found');
  if iid is null then
    insert into public.meeting_items (meeting_id, sort, body, sales_person_id)
    values (m.id, coalesce((select max(sort) from public.meeting_items where meeting_id = m.id), 0) + 1, btrim(p_body), p_sales_person)
    returning id into iid;
  else
    update public.meeting_items set body = btrim(p_body), updated_at = now() where id = iid and meeting_id = m.id;
    perform app.require(found, 'Note not found');
  end if;
  return iid;
end $$;
revoke execute on function public.save_meeting_item(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.save_meeting_item(uuid, uuid, text, uuid) to authenticated, service_role;
