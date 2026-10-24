-- Supplier quotes: pick the package's project / client and job reference from the system (projects, inquiries, execution projects) or type them
alter table public.sq_packages add column if not exists source_kind text check (source_kind in ('project', 'inquiry', 'exec'));
alter table public.sq_packages add column if not exists source_id uuid;

-- Names only, so people allowed into supplier quotes can pick a job without access to the CRM
create or replace function public.sq_jobs() returns table (kind text, id uuid, ref text, project_name text, client text, at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.sq_can(), 'No access to supplier quotes');
  return query
  select * from (
    select 'exec'::text, e.id, e.code, e.name, o.name, e.created_at
      from public.exec_projects e join public.projects p on p.id = e.project_id left join public.organizations o on o.id = p.organization_id
    union all
    select 'inquiry', i.id, i.code || case when i.revision > 0 then '-R' || i.revision else '' end, coalesce(i.project_name, i.inquiry_name), i.customer_name, i.created_at
      from public.inquiries i where i.code is not null
    union all
    select 'project', p.id, p.code, p.name, o.name, p.created_at
      from public.projects p left join public.organizations o on o.id = p.organization_id
  ) x order by 6 desc limit 1500;
end $$;
grant execute on function public.sq_jobs() to authenticated;
