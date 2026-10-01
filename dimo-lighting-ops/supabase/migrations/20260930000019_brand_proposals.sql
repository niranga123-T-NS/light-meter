-- Brand master list maintained by the Design and Estimation teams.
-- Designers, engineers and estimators can add a brand while they work; it is usable at once and recorded for
-- future use as "pending". The Design Manager, SM Estimation (and GM / DGM, System Administrator) approve,
-- correct, reject or merge brands. Renames and merges are carried into open design and estimation jobs.

alter table public.brands
  add column if not exists status text not null default 'approved' check (status in ('approved', 'pending', 'rejected')),
  add column if not exists proposed_by uuid references public.profiles (id),
  add column if not exists proposed_at timestamptz not null default now(),
  add column if not exists reviewed_by uuid references public.profiles (id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create or replace function app.is_brand_manager() returns boolean
language sql stable as $$ select app.has_role('design_manager', 'sm_estimation', 'gm', 'sys_admin') $$;

create or replace function app.can_add_brand() returns boolean
language sql stable as $$
  select app.is_brand_manager()
      or app.has_role('lighting_designer', 'lighting_engineer', 'am_estimation', 'estimation_exec')
$$;

drop policy if exists brands_write on public.brands;
drop policy if exists brands_insert on public.brands;
drop policy if exists brands_update on public.brands;
create policy brands_insert on public.brands for insert to authenticated with check (app.can_add_brand());
create policy brands_update on public.brands for update to authenticated using (app.is_brand_manager()) with check (app.is_brand_manager());

create or replace function app.brands_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  if new.name = '' then raise exception 'Enter the brand name'; end if;
  if exists (select 1 from public.brands b where lower(b.name) = lower(new.name) and b.id is distinct from new.id and b.status <> 'rejected') then
    raise exception 'The brand "%" is already in the list – select it instead', new.name;
  end if;
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.proposed_by := auth.uid();
    new.proposed_at := now();
    if app.is_brand_manager() then
      new.status := 'approved'; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    else
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null;
    end if;
  elsif new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    new.active := new.status <> 'rejected';
  end if;
  return new;
end $$;
drop trigger if exists brands_before on public.brands;
create trigger brands_before before insert or update on public.brands for each row execute function app.brands_before();

-- Replace a brand name inside open design / estimation jobs (issued quotations keep what was quoted)
create or replace function app.rename_brand_in_jobs(p_old text, p_new text, p_origin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.design_jobs set brands_specified = (
    select coalesce(jsonb_agg(case when e ->> 'brand' = p_old then e || jsonb_build_object('brand', p_new, 'origin', p_origin) else e end), '[]')
    from jsonb_array_elements(brands_specified) e)
  where status <> 'released' and brands_specified @> jsonb_build_array(jsonb_build_object('brand', p_old));
  update public.estimation_jobs set brands_offered = (
    select coalesce(jsonb_agg(case when e ->> 'brand' = p_old then e || jsonb_build_object('brand', p_new, 'origin', p_origin) else e end), '[]')
    from jsonb_array_elements(brands_offered) e)
  where status <> 'released' and brands_offered @> jsonb_build_array(jsonb_build_object('brand', p_old));
end $$;

create or replace function app.brands_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform app.notify_many(app.role_users('design_manager') || app.role_users('sm_estimation'), 'brand_proposed',
      'New brand to review: ' || new.name,
      format('Added by %s · %s · %s level', app.display_name(new.proposed_by), new.origin, new.level),
      'normal', null, null, '/brands');
  end if;
  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name or new.origin is distinct from old.origin then
      perform app.rename_brand_in_jobs(old.name, new.name, new.origin);
    end if;
    if new.status is distinct from old.status and new.proposed_by is not null and new.proposed_by <> auth.uid() then
      perform app.notify(new.proposed_by, 'brand_reviewed',
        case when new.status = 'approved' then 'Brand approved: ' || new.name else 'Brand rejected: ' || new.name end,
        coalesce(new.review_note, ''), 'normal', null, null, '/brands');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists brands_after on public.brands;
create trigger brands_after after insert or update on public.brands for each row execute function app.brands_after();

-- Duplicate brands: move every open job to the kept brand and reject the duplicate
create or replace function public.merge_brands(p_duplicate bigint, p_keep bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d public.brands; k public.brands;
begin
  perform app.require(app.is_brand_manager(), 'Only the Design Manager or SM Estimation can merge brands');
  select * into d from public.brands where id = p_duplicate;
  select * into k from public.brands where id = p_keep;
  perform app.require(d.id is not null and k.id is not null and d.id <> k.id, 'Choose two different brands');
  perform app.rename_brand_in_jobs(d.name, k.name, k.origin);
  update public.brands set status = 'rejected', review_note = 'Merged into ' || k.name where id = d.id;
end $$;


-- Same access rule as the other functions: signed-in users only
revoke execute on function app.is_brand_manager(), app.can_add_brand(), app.brands_before(), app.brands_after(),
  app.rename_brand_in_jobs(text, text, text), public.merge_brands(bigint, bigint) from public, anon;
grant execute on function app.is_brand_manager(), app.can_add_brand(), app.brands_before(), app.brands_after(),
  app.rename_brand_in_jobs(text, text, text), public.merge_brands(bigint, bigint) to authenticated, service_role;
