-- Inquiry name: several inquiries under one project (packages, areas, phases) each get their own name,
-- shown with the project name. Copies to other contractors keep the name; variation inquiries are named after the variation.
alter table public.inquiries add column if not exists inquiry_name text;

create or replace function app.inquiry_name_default() returns trigger language plpgsql as $$
begin
  new.inquiry_name := nullif(btrim(new.inquiry_name), '');
  if new.inquiry_name is null and new.copied_from_inquiry_id is not null then
    select inquiry_name into new.inquiry_name from public.inquiries where id = new.copied_from_inquiry_id;
  end if;
  if new.inquiry_name is null and new.variation_id is not null then
    select format('Variation %s – %s', v.code, v.title) into new.inquiry_name from public.variations v where v.id = new.variation_id;
  end if;
  return new;
end $$;
create trigger inquiries_name before insert or update of inquiry_name on public.inquiries
for each row execute function app.inquiry_name_default();

-- Existing variation inquiries
update public.inquiries i set inquiry_name = format('Variation %s – %s', v.code, v.title)
  from public.variations v where v.id = i.variation_id and i.inquiry_name is null;
