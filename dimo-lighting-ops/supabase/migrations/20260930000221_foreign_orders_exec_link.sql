-- Foreign orders (TESTING): a hand-over links to the project it comes from –
--  * a won order in Secured (the order book; includes supply-only orders from sales): fills in the project, the client and the
--    sales person, and the execution project of the same project if there is one;
--  * an execution project (older ones have no sales project): fills in the project and the client, and links the SEE;
--  * or neither ("not in the list"): typed by Ops.

alter table public.fo_handovers add column if not exists exec_project_id uuid references public.exec_projects (id) on delete set null;
alter table public.fo_handovers add column if not exists secured_id uuid references public.secured_projects (id) on delete set null;
create index if not exists fo_handovers_exec on public.fo_handovers (exec_project_id);
update public.fo_handovers h set exec_project_id = e.id from public.exec_projects e where h.exec_project_id is null and h.project_id is not null and e.project_id = h.project_id;

create or replace function app.fo_see_of(p_handover uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select e.see_id from public.fo_handovers h join public.exec_projects e on e.id = h.exec_project_id where h.id = p_handover),
                  (select e.see_id from public.fo_handovers h join public.exec_projects e on e.project_id = h.project_id where h.id = p_handover limit 1))
$$;

create or replace function public.fo_save_handover(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare h public.fo_handovers; hid uuid; rec date := nullif(p ->> 'received_on', '')::date; e public.exec_projects; sp public.secured_projects;
begin
  perform app.require(app.fo_keeper(), 'The Operations Executive records foreign orders');
  -- a won order (Secured) fills in the project, the client and the sales person when they are not given
  if nullif(p ->> 'secured_id', '') is not null then
    select * into sp from public.secured_projects where id = (p ->> 'secured_id')::uuid;
    perform app.require(found, 'Won order not found');
    p := p || jsonb_build_object('project_name', coalesce(nullif(btrim(p ->> 'project_name'), ''), sp.project_name),
                                 'client', coalesce(nullif(btrim(p ->> 'client'), ''), sp.customer, ''),
                                 'sales_person_id', coalesce(nullif(p ->> 'sales_person_id', ''), sp.sales_person_id::text, ''),
                                 'project_id', coalesce(nullif(p ->> 'project_id', ''), sp.project_id::text, ''));
    if nullif(p ->> 'exec_project_id', '') is null and sp.project_id is not null then
      p := p || jsonb_build_object('exec_project_id', coalesce((select id::text from public.exec_projects where project_id = sp.project_id limit 1), ''));
    end if;
  end if;
  -- an execution project fills in the project, the sales-project link and the client when they are not given
  if nullif(p ->> 'exec_project_id', '') is not null then
    select * into e from public.exec_projects where id = (p ->> 'exec_project_id')::uuid;
    perform app.require(found, 'Execution project not found');
    p := p || jsonb_build_object('project_name', coalesce(nullif(btrim(p ->> 'project_name'), ''), e.name),
                                 'client', coalesce(nullif(btrim(p ->> 'client'), ''), e.client_name, ''),
                                 'project_id', coalesce(nullif(p ->> 'project_id', ''), e.project_id::text, ''));
  end if;
  perform app.require(coalesce(btrim(p ->> 'project_name'), '') <> '', 'Enter the project');
  perform app.require(coalesce(btrim(p ->> 'client'), '') <> '', 'Enter the client');
  perform app.require(rec is not null and rec <= (now() at time zone app.tz())::date, 'Enter the date the hand-over was received');
  perform app.require(nullif(p ->> 'sales_person_id', '') is not null, 'Choose the sales person');
  if p_id is null then
    perform app.require(coalesce(btrim(p ->> 'delivery_location'), '') <> '', 'Enter the final delivery location');
    insert into public.fo_handovers (code, secured_id, exec_project_id, project_id, project_name, client, sales_person_id, received_on, pi_ref, client_new, delivery_location, notes)
    values (app.next_code('HO'), sp.id, e.id, nullif(p ->> 'project_id', '')::uuid, btrim(p ->> 'project_name'), btrim(p ->> 'client'),
            (p ->> 'sales_person_id')::uuid, rec, nullif(btrim(p ->> 'pi_ref'), ''), coalesce((p ->> 'client_new')::boolean, false),
            btrim(p ->> 'delivery_location'), nullif(btrim(p ->> 'notes'), ''))
    returning id into hid;
    insert into public.fo_steps (handover_id, step, done_on, ref) values (hid, 'ho_received', rec, nullif(btrim(p ->> 'pi_ref'), ''));
    return hid;
  end if;
  select * into h from public.fo_handovers where id = p_id for update;
  perform app.require(found, 'Hand-over not found');
  perform app.require(h.status = 'open', 'The hand-over is closed');
  update public.fo_handovers set secured_id = sp.id, exec_project_id = e.id, project_id = nullif(p ->> 'project_id', '')::uuid, project_name = btrim(p ->> 'project_name'), client = btrim(p ->> 'client'),
         sales_person_id = (p ->> 'sales_person_id')::uuid, received_on = rec, pi_ref = nullif(btrim(p ->> 'pi_ref'), ''),
         client_new = coalesce((p ->> 'client_new')::boolean, false), notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
   where id = p_id;
  update public.fo_steps set done_on = rec, ref = nullif(btrim(p ->> 'pi_ref'), '') where handover_id = p_id and order_id is null and step = 'ho_received';
  select * into h from public.fo_handovers where id = p_id;
  perform app.require(not exists (select 1 from public.fo_steps st join public.fo_step_defs d on d.key = st.step
                                   where st.handover_id = p_id and st.order_id is null and not app.fo_h_applies(d.conds, h)),
    'Client steps are already recorded – clear them first');
  return p_id;
end $$;
