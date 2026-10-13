-- Foreign orders (TESTING): issue records by the Operations Executive – a mistake, a delay, a complaint or a notice – against a
-- stage, or a set of its steps (steps whose order of progress is not known are grouped under their main stage), with any
-- reference files attached. Each record alerts SM Projects, the GM / DGM, SM Estimation, and the order's owners
-- (the sales person and the project's SEE). Ops marks it resolved, which tells the same people.

create table public.fo_notes (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.fo_handovers (id) on delete cascade,
  order_id uuid references public.fo_orders (id) on delete cascade,
  stage int not null check (stage between 1 and 9),
  steps text[] not null default '{}',
  kind text not null check (kind in ('mistake', 'delay', 'complaint', 'notice')),
  party text,
  title text not null,
  details text,
  occurred_on date not null,
  delay_days int check (delay_days is null or delay_days between 1 and 365),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.fo_notes (handover_id);
create index on public.fo_notes (order_id);

alter table public.fo_notes enable row level security;
create policy fo_notes_read on public.fo_notes for select to authenticated using (app.fo_can_read(handover_id));
grant select on public.fo_notes to authenticated;

create or replace function app.fo_note_people(p_handover uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select app.role_users('sm_projects', 'gm', 'sm_estimation') || app.fo_followers(p_handover)
$$;

create or replace function app.fo_note_kind(k text) returns text
language sql immutable as $$
  select case k when 'mistake' then 'Mistake' when 'delay' then 'Delay' when 'complaint' then 'Complaint' else 'Notice' end
$$;

-- p: {handover_id, order_id, stage, steps[], kind, party, title, details, occurred_on, delay_days}
create or replace function public.fo_add_note(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; o public.fo_orders; st int := nullif(p ->> 'stage', '')::int; k text := p ->> 'kind'; nid uuid;
        steps text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'steps', '[]'))), '{}'); bad text; dd int := nullif(p ->> 'delay_days', '')::int;
        occ date := nullif(p ->> 'occurred_on', '')::date; head text;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records these');
  if nullif(p ->> 'order_id', '') is not null then
    select * into o from public.fo_orders where id = (p ->> 'order_id')::uuid;
    perform app.require(found, 'Import order not found');
    select * into h from public.fo_handovers where id = o.handover_id;
  else
    select * into h from public.fo_handovers where id = nullif(p ->> 'handover_id', '')::uuid;
    perform app.require(found, 'Hand-over not found');
  end if;
  perform app.require(k in ('mistake', 'delay', 'complaint', 'notice'), 'Mistake, delay, complaint or notice?');
  perform app.require(st between 1 and 9, 'Choose the stage');
  perform app.require(o.id is not null or st <= 3, 'Stages 4 to 9 are recorded on the import order');
  perform app.require(coalesce(btrim(p ->> 'title'), '') <> '', 'What happened? (a short title)');
  perform app.require(occ is not null and occ <= (now() at time zone app.tz())::date, 'Enter the date (not in the future)');
  perform app.require(k <> 'delay' or dd is not null, 'A delay: how many working days?');
  select string_agg(x, ', ') into bad from unnest(steps) x where not exists (select 1 from public.fo_step_defs d where d.key = x and d.stage = st);
  perform app.require(bad is null, format('These steps are not in stage %s: %s', st, bad));
  insert into public.fo_notes (handover_id, order_id, stage, steps, kind, party, title, details, occurred_on, delay_days)
  values (h.id, o.id, st, steps, k, nullif(btrim(p ->> 'party'), ''), btrim(p ->> 'title'), nullif(btrim(p ->> 'details'), ''), occ, case when k = 'delay' then dd end)
  returning id into nid;
  head := case when o.id is not null then app.fo_order_head(o) else app.fo_head(h) end;
  perform app.notify_many(app.fo_note_people(h.id), 'foreign_order',
    format('%s – %s', app.fo_note_kind(k), btrim(p ->> 'title')),
    format('%s · stage %s%s%s%s', head, st, case when cardinality(steps) > 0 then ' (' || (select string_agg(d.label, ', ' order by d.seq) from public.fo_step_defs d where d.key = any (steps)) || ')' else '' end,
           case when nullif(btrim(p ->> 'party'), '') is not null then ' · ' || btrim(p ->> 'party') else '' end, case when k = 'delay' then format(' · %s working days', dd) else '' end),
    case when k in ('mistake', 'complaint') then 'critical'::public.priority else 'normal'::public.priority end,
    case when o.id is not null then 'fo_order' else 'fo_handover' end, coalesce(o.id, h.id),
    case when o.id is not null then '/orders/foreign/' || o.id else '/orders/foreign/ho/' || h.id end);
  return nid;
end $$;

create or replace function public.fo_resolve_note(p_id uuid, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare n public.fo_notes;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records these');
  select * into n from public.fo_notes where id = p_id for update;
  perform app.require(found and n.status = 'open', 'Not open');
  perform app.require(coalesce(btrim(p_resolution), '') <> '', 'How was it resolved?');
  update public.fo_notes set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = btrim(p_resolution) where id = p_id;
  perform app.notify_many(app.fo_note_people(n.handover_id), 'foreign_order', format('Resolved – %s', n.title), btrim(p_resolution), 'normal',
    case when n.order_id is not null then 'fo_order' else 'fo_handover' end, coalesce(n.order_id, n.handover_id),
    case when n.order_id is not null then '/orders/foreign/' || n.order_id else '/orders/foreign/ho/' || n.handover_id end);
end $$;
grant execute on function public.fo_add_note(jsonb), public.fo_resolve_note(uuid, text) to authenticated;

-- Reference files on a record: Ops attaches, everyone who sees the order reads
do $$
declare def text;
begin
  def := pg_get_functiondef('app.can_read_attachment(public.attachments)'::regprocedure);
  perform app.require(position('  case a.entity_type' || chr(10) || '  when ''fx_report'' then' in def) > 0, 'can_read_attachment anchor not found');
  def := replace(def, '  case a.entity_type' || chr(10) || '  when ''fx_report'' then',
    '  case a.entity_type' || chr(10) || '  when ''fo_note'' then' || chr(10) ||
    '    return exists (select 1 from public.fo_notes n where n.id = a.entity_id and app.fo_can_read(n.handover_id));' || chr(10) || '  when ''fx_report'' then');
  execute def;
  def := pg_get_functiondef('app.can_write_attachment(text, uuid, text)'::regprocedure);
  perform app.require(position('  case p_entity_type' || chr(10) || '  when ''fx_report'' then' in def) > 0, 'can_write_attachment anchor not found');
  def := replace(def, '  case p_entity_type' || chr(10) || '  when ''fx_report'' then',
    '  case p_entity_type' || chr(10) || '  when ''fo_note'' then return p_kind = ''fo_reference'' and app.fo_keeper() and exists (select 1 from public.fo_notes where id = p_entity_id);' || chr(10) || '  when ''fx_report'' then');
  execute def;
end $$;
