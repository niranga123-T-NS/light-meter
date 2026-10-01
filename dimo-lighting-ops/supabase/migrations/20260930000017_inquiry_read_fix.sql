-- Fix: a sales person saving a new inquiry got "new row violates row-level security policy for table inquiries".
-- The app saves with INSERT … RETURNING; the read policy looked the inquiry up by id, which cannot see a row
-- that is still being inserted. Check the row's own columns for the roles that create inquiries.
drop policy if exists inquiries_read on public.inquiries;
create policy inquiries_read on public.inquiries for select to authenticated
  using (app.has_role('gm', 'sm_projects')
         or (app.is_sales_person() and sales_person_id = auth.uid())
         or app.can_read_inquiry(id));
