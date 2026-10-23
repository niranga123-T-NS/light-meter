-- The engineer assigned to a claim (a trainee too) reads the sales report it came from – the site contact, location and photos
create policy warranty_reports_claim_engineer_read on public.warranty_reports for select to authenticated
  using (exists (select 1 from public.warranty_claims c where c.id = claim_id and c.assignee_id = auth.uid()));
