-- Supplier quotes: projects. A project (picked from the system or typed) holds its packages; each package holds the quotes and their
-- revised versions. The project page sums up every package; existing packages are put under a project made from their
-- Project / client and reference.

create table if not exists public.sq_projects (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null check (btrim(name) <> ''),
  client text,
  job_ref text,
  source_kind text check (source_kind in ('project', 'inquiry', 'exec')),
  source_id uuid,
  our_validity date,
  notes text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sq_projects_status on public.sq_projects (status);

create or replace function app.sq_project_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.code := coalesce(new.code, app.next_code('SQP')); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sq_projects_code on public.sq_projects;
create trigger sq_projects_code before insert or update on public.sq_projects for each row execute function app.sq_project_code();

alter table public.sq_projects enable row level security;
create policy sq_projects_read on public.sq_projects for select to authenticated using (app.sq_can());
create policy sq_projects_ins on public.sq_projects for insert to authenticated with check (app.sq_can());
create policy sq_projects_upd on public.sq_projects for update to authenticated using (app.sq_can()) with check (app.sq_can());
grant select, insert, update, delete on public.sq_projects to authenticated;

alter table public.sq_packages add column if not exists project_id uuid references public.sq_projects (id);
create index if not exists sq_packages_project on public.sq_packages (project_id);
create policy sq_projects_del on public.sq_projects for delete to authenticated using (app.sq_can() and not exists (select 1 from public.sq_packages p where p.project_id = sq_projects.id));

-- A package carries its project's name and reference (older screens and the reports read them from the package)
create or replace function app.sq_package_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.sq_projects;
begin
  if new.project_id is not null then
    select * into p from public.sq_projects where id = new.project_id;
    new.project_name := coalesce(nullif(btrim(concat_ws(' – ', p.name, p.client)), ''), new.project_name);
    new.job_ref := coalesce(p.job_ref, new.job_ref);
    new.source_kind := coalesce(p.source_kind, new.source_kind);
    new.source_id := coalesce(p.source_id, new.source_id);
    new.our_validity := coalesce(new.our_validity, p.our_validity);
  end if;
  return new;
end $$;
drop trigger if exists sq_packages_project on public.sq_packages;
create trigger sq_packages_project before insert or update of project_id on public.sq_packages for each row execute function app.sq_package_project();

-- Renaming a project carries to its packages
create or replace function app.sq_project_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name or new.client is distinct from old.client or new.job_ref is distinct from old.job_ref then
    update public.sq_packages set project_name = nullif(btrim(concat_ws(' – ', new.name, new.client)), ''), job_ref = new.job_ref where project_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists sq_projects_sync on public.sq_projects;
create trigger sq_projects_sync after update on public.sq_projects for each row execute function app.sq_project_sync();

-- Existing packages: one project per job (picked source, or name + reference)
do $$
declare r record; pid uuid;
begin
  for r in
    select coalesce(source_kind, '') as sk, source_id, coalesce(nullif(btrim(project_name), ''), 'Project not named') as pn, coalesce(job_ref, '') as jr,
           min(created_at) as first_at, (array_agg(created_by order by created_at))[1] as first_by
      from public.sq_packages where project_id is null
     group by 1, 2, 3, 4
  loop
    insert into public.sq_projects (name, job_ref, source_kind, source_id, created_by, created_at)
    values (r.pn, nullif(r.jr, ''), nullif(r.sk, ''), r.source_id, r.first_by, r.first_at) returning id into pid;
    update public.sq_packages set project_id = pid
     where project_id is null and coalesce(source_kind, '') = r.sk and source_id is not distinct from r.source_id
       and coalesce(nullif(btrim(project_name), ''), 'Project not named') = r.pn and coalesce(job_ref, '') = r.jr;
  end loop;
end $$;
