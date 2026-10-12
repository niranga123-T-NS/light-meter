-- Offers & competition: the tender-results register extended to ordinary quotations
--  * Any inquiry with a quotation can carry its competition record: "Record competitors" on the inquiry creates one
--    (type 'quotation') from the inquiry and its latest quotation – our price and brands filled in. It then works
--    like a tender result: the BOQ, each competitor with a page of their own (price, brands, item prices, documents).
--  * Past quotations not in the system are entered in the register as type 'Quotation'.
--  * The inquiry's result (won / lost, lost to whom) flows into its quotation record; the winning competitor is marked.
--  * Item prices carry our unit price beside theirs for comparison.
--  * Competitor profile: notes, brands they carry, website – kept by SM Projects and the Estimation managers.

alter table public.tenders add column if not exists inquiry_id uuid unique references public.inquiries (id);
alter table public.tenders drop constraint if exists tenders_tender_type_check;
alter table public.tenders add constraint tenders_tender_type_check check (tender_type in ('open', 'selective', 'negotiated', 're_tender', 'quotation'));
alter table public.tender_bids add column if not exists won boolean not null default false;
alter table public.tender_bid_lines add column if not exists our_unit_price numeric(16, 2);
alter table public.competitors add column if not exists notes text;
alter table public.competitors add column if not exists brands text[] not null default '{}';
alter table public.competitors add column if not exists website text;
alter table public.competitors add column if not exists updated_by uuid references public.profiles (id);
alter table public.competitors add column if not exists updated_at timestamptz;

drop policy if exists competitors_update on public.competitors;
create policy competitors_update on public.competitors for update to authenticated
  using (app.has_role('sm_projects', 'sys_admin', 'sm_estimation', 'am_estimation'))
  with check (app.has_role('sm_projects', 'sys_admin', 'sm_estimation', 'am_estimation'));

-- A quotation's result does not move the project's tender stage (the inquiry result already does)
create or replace function app.tenders_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare rank int;
begin
  if new.tender_type = 'quotation' or new.project_id is null then return null; end if;
  perform set_config('app.reason', 'Tender result ' || new.tender_no, true);
  if new.result_status = 'awarded_to_us' then
    update public.projects set stage = 'Award', milestone = 'won' where id = new.project_id;
  elsif new.result_status = 'awarded_to_competitor' then
    update public.projects set stage = 'Award', milestone = 'lost',
      status_reason = coalesce(new.lost_reason, 'Price') where id = new.project_id;
  elsif new.result_status = 'opened' then
    select our_rank into rank from public.tender_rankings where tender_id = new.id;
    if rank = 1 then
      update public.projects set milestone = 'negotiating' where id = new.project_id
        and milestone in ('lead_identified', 'design_involvement', 'brand_specified', 'quotation_submitted');
    end if;
  end if;
  perform set_config('app.reason', '', true);
  return null;
end $$;

-- One winner per tender / quotation
create or replace function app.tender_bid_one_winner() returns trigger
language plpgsql as $$
begin
  update public.tender_bids set won = false where tender_id = new.tender_id and id <> new.id and won;
  return null;
end $$;
drop trigger if exists tender_bid_one_winner on public.tender_bids;
create trigger tender_bid_one_winner after insert or update of won on public.tender_bids
for each row when (new.won) execute function app.tender_bid_one_winner();

create or replace function app.offer_result(p_result text) returns text
language sql immutable as $$
  select case p_result when 'won' then 'awarded_to_us' when 'lost' then 'awarded_to_competitor' when 'cancelled' then 'cancelled' else 'opened' end
$$;

-- The competition record of an inquiry: found or created (the sales person, SM Projects, SM / AM Estimation)
create or replace function public.start_offer_record(p_inquiry uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.inquiries; q public.quotations; tid uuid;
begin
  select * into i from public.inquiries where id = p_inquiry;
  if i.id is null then raise exception 'Inquiry not found'; end if;
  if not (i.sales_person_id = auth.uid() or app.has_role('sm_projects', 'sm_estimation', 'am_estimation')) then
    raise exception 'Only the sales person, SM Projects, SM Estimation or AM Estimation record the competition';
  end if;
  select id into tid from public.tenders where inquiry_id = p_inquiry;
  if tid is not null then return tid; end if;
  -- A tender already recorded from the sales visit for this quotation: link it instead of a second record
  select t.id into tid from public.tenders t join public.quotations x on x.id = t.quotation_id
  where x.inquiry_id = p_inquiry and t.inquiry_id is null order by t.created_at limit 1;
  if tid is not null then
    update public.tenders set inquiry_id = p_inquiry where id = tid;
    return tid;
  end if;
  select * into q from public.quotations where inquiry_id = p_inquiry order by released_at desc limit 1;
  if q.id is null then raise exception 'Record the competition once the quotation is released'; end if;
  insert into public.tenders (inquiry_id, project_id, project_name, client_organization_id, client_name, sales_person_id, tender_no, tender_name,
                              tender_type, duty_status, closing_date, opening_date, our_price, our_brands, quotation_id, result_status, lost_reason, entered_by)
  values (p_inquiry, i.project_id, i.project_name, i.organization_id, i.customer_name, i.sales_person_id, q.full_no, coalesce(i.project_name, i.code, q.full_no),
          'quotation', coalesce(i.duty_status, 'duty_paid'), coalesce(i.submitted_to_client_at, q.submitted_to_client_at, q.released_at)::date,
          coalesce(i.client_response_at, i.submitted_to_client_at, q.submitted_to_client_at, q.released_at)::date, q.quoted_value,
          array(select distinct e ->> 'brand' from jsonb_array_elements(coalesce(q.brands_offered, '[]'::jsonb)) e where coalesce(e ->> 'brand', '') <> ''),
          q.id, app.offer_result(i.result), case when i.result = 'lost' then i.lost_reason end, auth.uid())
  returning id into tid;
  return tid;
end $$;
grant execute on function public.start_offer_record(uuid) to authenticated;

-- The inquiry's result flows into its quotation record
create or replace function app.inquiry_offer_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tenders set result_status = app.offer_result(new.result), lost_reason = case when new.result = 'lost' then coalesce(new.lost_reason, lost_reason) end, updated_at = now()
  where inquiry_id = new.id and tender_type = 'quotation';
  if new.result = 'lost' and new.lost_to_competitor_id is not null then
    update public.tender_bids b set won = true from public.tenders t
    where t.id = b.tender_id and t.inquiry_id = new.id and t.tender_type = 'quotation' and b.competitor_id = new.lost_to_competitor_id and not b.won;
  end if;
  return null;
end $$;
drop trigger if exists inquiry_offer_sync on public.inquiries;
create trigger inquiry_offer_sync after update of result, lost_to_competitor_id, lost_reason on public.inquiries
for each row when (old.result is distinct from new.result or old.lost_to_competitor_id is distinct from new.lost_to_competitor_id or old.lost_reason is distinct from new.lost_reason)
execute function app.inquiry_offer_sync();

-- A competitor added after the inquiry was recorded as lost to them is marked as the winner
create or replace function app.tender_bid_winner_default() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tenders t join public.inquiries i on i.id = t.inquiry_id
             where t.id = new.tender_id and t.tender_type = 'quotation' and i.result = 'lost' and i.lost_to_competitor_id = new.competitor_id) then
    new.won := true;
  end if;
  return new;
end $$;
drop trigger if exists tender_bid_winner_default on public.tender_bids;
create trigger tender_bid_winner_default before insert on public.tender_bids for each row execute function app.tender_bid_winner_default();
