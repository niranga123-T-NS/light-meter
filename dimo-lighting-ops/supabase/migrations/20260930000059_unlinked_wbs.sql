-- Project codes (WBS) invoiced in the OR files of a financial year that are not on any secured project.
-- Their invoicing does not count toward anyone's target until Operations links the code to a secured project.
create or replace function public.unlinked_wbs(p_fy int)
returns table (wbs text, invoiced numeric, months int, last_month date)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app.require(app.sees_finance(), 'Not available for your role');
  return query
    select w.wbs, sum(w.revenue), count(distinct u.month)::int, max(u.month)
      from public.wbs_actuals w join public.or_uploads u on u.id = w.upload_id
     where u.fy = p_fy
       and not exists (select 1 from public.secured_projects s where app.wbs_base(s.wbs) = w.wbs)
     group by w.wbs
    having sum(w.revenue) <> 0
     order by sum(w.revenue) desc;
end $$;
revoke execute on function public.unlinked_wbs(int) from public, anon;
grant execute on function public.unlinked_wbs(int) to authenticated;
