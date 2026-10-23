-- Customer type (visit category): Project Management – in the seed list but missing on the live system, which was set up before it was added
insert into public.master_lists (list_name, value, grp, tags, sort_order)
values ('visit_category', 'Project Management', null, '{}'::text[], 12)
on conflict (list_name, value) do update set active = true;
