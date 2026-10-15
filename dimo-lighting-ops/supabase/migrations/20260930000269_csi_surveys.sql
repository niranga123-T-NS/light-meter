-- Customer satisfaction (CSI) – "Light up DIMO": the sales person starts a survey from the CSI tab for a named customer contact;
-- the customer fills it on the sales person's tablet or through a one-time link (no login), or the sales person fills it with
-- the customer on a call. Eight short steps: the overall dimmer, the journey stages, swipe cards, 100 importance points,
-- compared with other suppliers, recommend (0–10) with reference permission, one wish, thank you.
--  * Seen by the sales person and SM Projects / GM / sys admin. Low results (overall < 60 or recommend ≤ 6) alert the sales
--    person and SM Projects for a call within 48 hours; a customer who agrees to be a reference is passed to the Lighting Designer.

create table if not exists public.csi_surveys (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  token text unique not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  sales_person_id uuid not null default auth.uid() references public.profiles (id),
  organization_id uuid not null references public.organizations (id),
  project_id uuid references public.projects (id),
  contact_id uuid references public.contacts (id),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 120),
  contact_role text check (contact_role is null or length(contact_role) <= 120),
  stages text[] not null check (cardinality(stages) between 1 and 6
    and stages <@ array['inquiry', 'design', 'quotation', 'delivery', 'installation', 'after_sales']),
  channel text not null default 'link' check (channel in ('link', 'tablet', 'call')),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  expires_at timestamptz not null default now() + interval '30 days',
  filled_by text check (filled_by in ('customer', 'sales')),
  overall int check (overall between 0 and 100),
  stage_scores jsonb,
  cards jsonb,
  points jsonb,
  vs_others int check (vs_others between -2 and 2),
  nps int check (nps between 0 and 10),
  reference_ok boolean,
  quote_ok boolean,
  wish text check (wish is null or length(wish) <= 1000),
  completed_at timestamptz,
  alert boolean not null default false,
  follow_up_note text check (follow_up_note is null or length(follow_up_note) <= 1000),
  followed_up_at timestamptz,
  followed_up_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists csi_surveys_sales on public.csi_surveys (sales_person_id, created_at desc);
create index if not exists csi_surveys_org on public.csi_surveys (organization_id);
alter table public.csi_surveys enable row level security;

create or replace function app.csi_manager() returns boolean
language sql stable security definer set search_path = public as $$ select app.has_role('sm_projects', 'gm', 'sys_admin') $$;

drop policy if exists csi_read on public.csi_surveys;
create policy csi_read on public.csi_surveys for select to authenticated using (sales_person_id = auth.uid() or app.csi_manager());
grant select on public.csi_surveys to authenticated;

-- ---------------------------------------------------------------------------
-- Sales person: start a survey
-- p: {organization_id, project_id, contact_id, contact_name, contact_role, stages[], channel}
create or replace function public.csi_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; st text[] := array(select jsonb_array_elements_text(coalesce(p -> 'stages', '[]'::jsonb)));
begin
  perform app.require(app.is_sales_person(), 'Only sales people start a CSI');
  perform app.require(exists (select 1 from public.organizations where id = nullif(p ->> 'organization_id', '')::uuid), 'Choose the customer');
  perform app.require(coalesce(length(btrim(p ->> 'contact_name')), 0) >= 2, 'Enter the name of the person who answers');
  perform app.require(cardinality(st) >= 1, 'Choose at least one stage the customer went through');
  insert into public.csi_surveys (code, organization_id, project_id, contact_id, contact_name, contact_role, stages, channel)
  values (app.next_code('CSI'), (p ->> 'organization_id')::uuid, nullif(p ->> 'project_id', '')::uuid, nullif(p ->> 'contact_id', '')::uuid,
          btrim(p ->> 'contact_name'), nullif(btrim(p ->> 'contact_role'), ''), st, coalesce(nullif(p ->> 'channel', ''), 'link'))
  returning id into sid;
  return sid;
end $$;
revoke all on function public.csi_create(jsonb) from public, anon;
grant execute on function public.csi_create(jsonb) to authenticated;

-- The survey seen by whoever holds the link (no login needed) – only what the screens show
create or replace function public.csi_context(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.csi_surveys;
begin
  select * into s from public.csi_surveys where token = p_token;
  if s.id is null or length(coalesce(p_token, '')) < 40 then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'code', s.code,
    'status', case when s.status = 'open' and s.expires_at < now() then 'expired' else s.status end,
    'customer', (select name from public.organizations where id = s.organization_id),
    'project', (select name from public.projects where id = s.project_id),
    'contact', s.contact_name,
    'sales', (select full_name from public.profiles where id = s.sales_person_id),
    'sales_phone', (select phone from public.profiles where id = s.sales_person_id),
    'stages', to_jsonb(s.stages));
end $$;
revoke all on function public.csi_context(text) from public;
grant execute on function public.csi_context(text) to anon, authenticated;

-- Submit the answers (customer by link / tablet, or the sales person on a call)
-- a: {overall, stage_scores{stage:1..5}, cards{key:-1|0|1}, points{price,quality,speed,support,after_sales}, vs_others, nps,
--     reference_ok, quote_ok, wish}
create or replace function public.csi_submit(p_token text, a jsonb, p_by text default 'customer') returns void
language plpgsql security definer set search_path = public as $$
declare s public.csi_surveys; pts jsonb := coalesce(a -> 'points', '{}'); total int; k text; v jsonb; fb text; low boolean; head text;
begin
  select * into s from public.csi_surveys where token = p_token for update;
  perform app.require(s.id is not null and length(coalesce(p_token, '')) >= 40, 'This survey link is not valid');
  perform app.require(s.status = 'open', 'This survey is already completed – thank you');
  perform app.require(s.expires_at >= now(), 'This survey link has expired – please ask your DIMO contact for a new one');
  perform app.require((a ->> 'overall') ~ '^\d+$' and (a ->> 'overall')::int between 0 and 100, 'Set the overall dimmer');
  perform app.require((a ->> 'nps') ~ '^\d+$' and (a ->> 'nps')::int between 0 and 10, 'Choose how likely you are to recommend us');
  -- journey stage scores: only the survey's stages, 1..5
  for k, v in select * from jsonb_each(coalesce(a -> 'stage_scores', '{}')) loop
    perform app.require(k = any (s.stages) and v::text ~ '^[1-5]$', 'Invalid stage score');
  end loop;
  for k, v in select * from jsonb_each(coalesce(a -> 'cards', '{}')) loop
    perform app.require(k ~ '^[a-z_]{2,30}$' and v::text in ('-1', '0', '1'), 'Invalid card answer');
  end loop;
  select coalesce(sum(value::text::int), 0) into total from jsonb_each(pts) where key in ('price', 'quality', 'speed', 'support', 'after_sales') and value::text ~ '^\d+$';
  perform app.require(total = 100 and (select count(*) from jsonb_object_keys(pts)) = 5, 'Share exactly 100 points');
  perform app.require(a ->> 'vs_others' is null or (a ->> 'vs_others') ~ '^-?[0-2]$', 'Invalid comparison');
  fb := case when auth.uid() = s.sales_person_id and p_by = 'sales' then 'sales' else 'customer' end;
  low := (a ->> 'overall')::int < 60 or (a ->> 'nps')::int <= 6;
  update public.csi_surveys set status = 'completed', completed_at = now(), filled_by = fb,
         overall = (a ->> 'overall')::int, stage_scores = coalesce(a -> 'stage_scores', '{}'), cards = coalesce(a -> 'cards', '{}'), points = pts,
         vs_others = nullif(a ->> 'vs_others', '')::int, nps = (a ->> 'nps')::int,
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
end $$;
revoke all on function public.csi_submit(text, jsonb, text) from public;
grant execute on function public.csi_submit(text, jsonb, text) to anon, authenticated;

-- The sales person (or SM Projects) records the follow-up call
create or replace function public.csi_follow_up(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.csi_surveys;
begin
  select * into s from public.csi_surveys where id = p_id;
  perform app.require(s.id is not null, 'Survey not found');
  perform app.require(s.sales_person_id = auth.uid() or app.has_role('sm_projects'), 'Only the sales person or SM Projects records the follow-up');
  perform app.require(s.status = 'completed', 'The survey is not completed yet');
  perform app.require(length(btrim(coalesce(p_note, ''))) >= 10, 'Write what was agreed with the customer (at least 10 characters)');
  update public.csi_surveys set follow_up_note = btrim(p_note), followed_up_at = now(), followed_up_by = auth.uid() where id = p_id;
end $$;
revoke all on function public.csi_follow_up(uuid, text) from public, anon;
grant execute on function public.csi_follow_up(uuid, text) to authenticated;

create or replace function public.csi_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.csi_surveys set status = 'cancelled' where id = p_id and status = 'open' and sales_person_id = auth.uid();
  perform app.require(found, 'Only an open survey of yours can be cancelled');
end $$;
revoke all on function public.csi_cancel(uuid) from public, anon;
grant execute on function public.csi_cancel(uuid) to authenticated;

select app.fix_function_owners();
