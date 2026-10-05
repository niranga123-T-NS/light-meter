-- Special notes from the Design team on a design job (assumptions, exclusions, things Estimation and Sales must know).
-- Written by the designer / engineer on the job or the Design Manager; read by everyone who can read the inquiry.
create table public.design_notes (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.inquiries (id),
  design_job_id uuid not null references public.design_jobs (id) on delete cascade,
  note text not null check (btrim(note) <> ''),
  important boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.design_notes (design_job_id);
create index on public.design_notes (inquiry_id);
alter table public.design_notes enable row level security;
create policy design_notes_read on public.design_notes for select to authenticated using (app.can_read_inquiry(inquiry_id));
grant select on public.design_notes to authenticated;

create or replace function public.add_design_note(p_job uuid, p_note text, p_important boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare j public.design_jobs; i public.inquiries; nid bigint; who uuid[];
begin
  select * into j from public.design_jobs where id = p_job;
  perform app.require(j.id is not null, 'Design job not found');
  perform app.require(j.assignee_id = auth.uid() or app.has_role('design_manager', 'gm'),
    'Only the designer / engineer on this job or the Design Manager adds notes');
  perform app.require(coalesce(btrim(p_note), '') <> '', 'Write the note');
  select * into i from public.inquiries where id = j.inquiry_id;
  insert into public.design_notes (inquiry_id, design_job_id, note, important) values (j.inquiry_id, j.id, btrim(p_note), coalesce(p_important, false))
  returning id into nid;
  -- Told: the sales person, the estimator on the job (or estimation management), and the Design Manager / designer
  who := array[i.sales_person_id, j.assignee_id]
         || coalesce((select array_agg(distinct e.assignee_id) from public.estimation_jobs e where e.inquiry_id = i.id and e.assignee_id is not null), '{}')
         || case when not exists (select 1 from public.estimation_jobs e where e.inquiry_id = i.id and e.assignee_id is not null)
                 then app.role_users('sm_estimation') else '{}' end
         || app.role_users('design_manager');
  -- An important note pops up and must be opened
  perform app.notify_many(array(select distinct x from unnest(who) x where x is not null and x <> auth.uid()),
    case when p_important then 'design_note_important' else 'design_note' end,
    format('%sDesign note – %s', case when p_important then 'Important: ' else '' end, coalesce(i.code, i.project_name)),
    format('%s · %s', app.display_name(auth.uid()), left(btrim(p_note), 300)),
    'normal', 'inquiry', i.id, '/inquiries/' || i.id, null, coalesce(p_important, false));
  return nid;
end $$;

-- The writer (or the Design Manager) removes a note
create or replace function public.remove_design_note(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare n public.design_notes;
begin
  select * into n from public.design_notes where id = p_id;
  perform app.require(n.id is not null, 'Note not found');
  perform app.require(n.created_by = auth.uid() or app.has_role('design_manager', 'gm'), 'Only the writer or the Design Manager removes a note');
  delete from public.design_notes where id = p_id;
end $$;

revoke execute on function public.add_design_note(uuid, text, boolean), public.remove_design_note(bigint) from public, anon;
grant execute on function public.add_design_note(uuid, text, boolean), public.remove_design_note(bigint) to authenticated, service_role;
