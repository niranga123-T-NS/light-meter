-- Electricity tariffs from the PUCSL decision of May 2026 (Annex 2, 30-day billing cycle), effective 11 May 2026
--  * CEB's distribution is now EDL: its categories move to EDL. The same approved tariff applies to EDL and LECO;
--    LECO also has the optional pre-paid scheme.
--  * Each category keeps its flat energy charge, or its time-of-use rates (peak 18:30–22:30, day 05:30–18:30,
--    off-peak 22:30–05:30), the fixed charge and the demand charge. Block tariffs keep the rate of their top block
--    (the saved energy comes off it) and list the blocks in the note.
--  * Categories no longer in the schedule are taken out of the list (kept for earlier calculations).

alter table public.electricity_tariffs add column if not exists family text;
alter table public.electricity_tariffs add column if not exists peak numeric(10, 2);
alter table public.electricity_tariffs add column if not exists day numeric(10, 2);
alter table public.electricity_tariffs add column if not exists off_peak numeric(10, 2);
alter table public.electricity_tariffs add column if not exists fixed numeric(12, 2);
alter table public.electricity_tariffs add column if not exists demand numeric(12, 2);
alter table public.electricity_tariffs drop constraint if exists electricity_tariffs_supplier_check;
alter table public.electricity_tariffs add constraint electricity_tariffs_supplier_check check (supplier in ('CEB', 'EDL', 'LECO'));

update public.electricity_tariffs set active = false;

insert into public.electricity_tariffs (supplier, code, name, family, rate, peak, day, off_peak, fixed, demand, note, sort, effective_from, active, updated_at)
select v.supplier, v.code, v.name, v.family, v.rate, v.peak, v.day, v.off_peak, v.fixed, v.demand, v.note, v.sort, date '2026-05-11', true, now()
from (values
  ('EDL', 'D-1A', 'Domestic – up to 60 kWh a month', 'Domestic', 9.0, null, null, null, 210.0, null, '0–30 kWh 5.00 (fixed 80) · 31–60 kWh 9.00 (fixed 210)', 1),
  ('EDL', 'D-1B', 'Domestic – 61 to 180 kWh a month', 'Domestic', 44.0, null, null, null, 1500.0, null, '0–60 kWh 14.00 · 61–90 20.00 (fixed 400) · 91–120 28.00 (fixed 1,000) · 121–180 44.00 (fixed 1,500)', 2),
  ('EDL', 'D-1C', 'Domestic – above 180 kWh a month', 'Domestic', 100.0, null, null, null, 2500.0, null, '0–180 kWh 32.50 · above 180 kWh 100.00 · fixed 2,500', 3),
  ('EDL', 'D-TOU', 'Domestic – time of use', 'Domestic', null, 106.0, 47.0, 33.0, 2500.0, null, null, 4),
  ('EDL', 'R-1A', 'Religious & charitable – up to 180 kWh a month', 'Religious & charitable', 19.0, null, null, null, 1300.0, null, '0–30 kWh 4.50 (fixed 75) · 31–90 4.50 (200) · 91–120 8.00 (350) · 121–180 19.00 (1,300)', 5),
  ('EDL', 'R-1B', 'Religious & charitable – above 180 kWh a month', 'Religious & charitable', 35.0, null, null, null, 2000.0, null, '0–180 kWh 11.80 · above 180 kWh 35.00 · fixed 2,000', 6),
  ('EDL', 'GP-1A', 'General purpose 1 – up to 180 kWh a month (400/230 V, up to 42 kVA)', 'General purpose', 27.0, null, null, null, 500.0, null, null, 7),
  ('EDL', 'GP-1B', 'General purpose 1 – above 180 kWh a month (400/230 V, up to 42 kVA)', 'General purpose', 36.0, null, null, null, 1600.0, null, null, 8),
  ('EDL', 'GP-2', 'General purpose 2 – 400/230 V, above 42 kVA', 'General purpose', null, 78.0, 51.0, 40.0, 6000.0, 1800.0, null, 9),
  ('EDL', 'GP-3', 'General purpose 3 – 11 kV and above', 'General purpose', null, 77.0, 49.0, 39.0, 6000.0, 1700.0, null, 10),
  ('EDL', 'I-1A', 'Industrial 1 – up to 300 kWh a month (400/230 V, up to 42 kVA)', 'Industrial', 9.0, null, null, null, 300.0, null, null, 11),
  ('EDL', 'I-1B', 'Industrial 1 – above 300 kWh a month (400/230 V, up to 42 kVA)', 'Industrial', 18.0, null, null, null, 800.0, null, null, 12),
  ('EDL', 'I-2', 'Industrial 2 – 400/230 V, above 42 kVA', 'Industrial', null, 39.0, 19.0, 16.5, 6000.0, 1650.0, null, 13),
  ('EDL', 'I-3', 'Industrial 3 – 11 kV and above', 'Industrial', null, 38.0, 18.0, 15.5, 6000.0, 1600.0, null, 14),
  ('EDL', 'H-1A', 'Hotel 1 – up to 300 kWh a month (400/230 V, up to 42 kVA)', 'Hotel', 9.0, null, null, null, 300.0, null, null, 15),
  ('EDL', 'H-1B', 'Hotel 1 – above 300 kWh a month (400/230 V, up to 42 kVA)', 'Hotel', 18.0, null, null, null, 800.0, null, null, 16),
  ('EDL', 'H-2', 'Hotel 2 – 400/230 V, above 42 kVA', 'Hotel', null, 39.0, 19.0, 16.5, 6000.0, 1650.0, null, 17),
  ('EDL', 'H-3', 'Hotel 3 – 11 kV and above', 'Hotel', null, 38.0, 18.0, 15.5, 6000.0, 1600.0, null, 18),
  ('EDL', 'GV-1A', 'Government 1 – up to 180 kWh a month (400/230 V, up to 42 kVA)', 'Government', 34.5, null, null, null, 600.0, null, null, 19),
  ('EDL', 'GV-1B', 'Government 1 – above 180 kWh a month (400/230 V, up to 42 kVA)', 'Government', 45.0, null, null, null, 1900.0, null, null, 20),
  ('EDL', 'GV-2', 'Government 2 – 400/230 V, above 42 kVA', 'Government', null, 78.0, 54.0, 40.0, 6000.0, 1800.0, null, 21),
  ('EDL', 'GV-3', 'Government 3 – 11 kV and above', 'Government', null, 77.0, 53.0, 39.0, 6000.0, 1700.0, null, 22),
  ('EDL', 'SL', 'Street lighting', 'Street lighting', 60.0, null, null, null, null, null, null, 23),
  ('EDL', 'AGR', 'Agriculture – optional time of use', 'Agriculture', null, 28.0, 14.0, 8.0, 750.0, null, null, 24),
  ('EDL', 'EVC-1', 'EV charging 1 – 400/230 V, up to 42 kVA', 'EV charging', null, 70.0, 15.0, 31.0, 1600.0, null, null, 25),
  ('EDL', 'EVC-2', 'EV charging 2 – above 42 kVA', 'EV charging', null, 70.0, 15.0, 31.0, 5000.0, 1500.0, null, 26),
  ('LECO', 'D-1A', 'Domestic – up to 60 kWh a month', 'Domestic', 9.0, null, null, null, 210.0, null, '0–30 kWh 5.00 (fixed 80) · 31–60 kWh 9.00 (fixed 210)', 27),
  ('LECO', 'D-1B', 'Domestic – 61 to 180 kWh a month', 'Domestic', 44.0, null, null, null, 1500.0, null, '0–60 kWh 14.00 · 61–90 20.00 (fixed 400) · 91–120 28.00 (fixed 1,000) · 121–180 44.00 (fixed 1,500)', 28),
  ('LECO', 'D-1C', 'Domestic – above 180 kWh a month', 'Domestic', 100.0, null, null, null, 2500.0, null, '0–180 kWh 32.50 · above 180 kWh 100.00 · fixed 2,500', 29),
  ('LECO', 'D-TOU', 'Domestic – time of use', 'Domestic', null, 106.0, 47.0, 33.0, 2500.0, null, null, 30),
  ('LECO', 'R-1A', 'Religious & charitable – up to 180 kWh a month', 'Religious & charitable', 19.0, null, null, null, 1300.0, null, '0–30 kWh 4.50 (fixed 75) · 31–90 4.50 (200) · 91–120 8.00 (350) · 121–180 19.00 (1,300)', 31),
  ('LECO', 'R-1B', 'Religious & charitable – above 180 kWh a month', 'Religious & charitable', 35.0, null, null, null, 2000.0, null, '0–180 kWh 11.80 · above 180 kWh 35.00 · fixed 2,000', 32),
  ('LECO', 'GP-1A', 'General purpose 1 – up to 180 kWh a month (400/230 V, up to 42 kVA)', 'General purpose', 27.0, null, null, null, 500.0, null, null, 33),
  ('LECO', 'GP-1B', 'General purpose 1 – above 180 kWh a month (400/230 V, up to 42 kVA)', 'General purpose', 36.0, null, null, null, 1600.0, null, null, 34),
  ('LECO', 'GP-2', 'General purpose 2 – 400/230 V, above 42 kVA', 'General purpose', null, 78.0, 51.0, 40.0, 6000.0, 1800.0, null, 35),
  ('LECO', 'GP-3', 'General purpose 3 – 11 kV and above', 'General purpose', null, 77.0, 49.0, 39.0, 6000.0, 1700.0, null, 36),
  ('LECO', 'I-1A', 'Industrial 1 – up to 300 kWh a month (400/230 V, up to 42 kVA)', 'Industrial', 9.0, null, null, null, 300.0, null, null, 37),
  ('LECO', 'I-1B', 'Industrial 1 – above 300 kWh a month (400/230 V, up to 42 kVA)', 'Industrial', 18.0, null, null, null, 800.0, null, null, 38),
  ('LECO', 'I-2', 'Industrial 2 – 400/230 V, above 42 kVA', 'Industrial', null, 39.0, 19.0, 16.5, 6000.0, 1650.0, null, 39),
  ('LECO', 'I-3', 'Industrial 3 – 11 kV and above', 'Industrial', null, 38.0, 18.0, 15.5, 6000.0, 1600.0, null, 40),
  ('LECO', 'H-1A', 'Hotel 1 – up to 300 kWh a month (400/230 V, up to 42 kVA)', 'Hotel', 9.0, null, null, null, 300.0, null, null, 41),
  ('LECO', 'H-1B', 'Hotel 1 – above 300 kWh a month (400/230 V, up to 42 kVA)', 'Hotel', 18.0, null, null, null, 800.0, null, null, 42),
  ('LECO', 'H-2', 'Hotel 2 – 400/230 V, above 42 kVA', 'Hotel', null, 39.0, 19.0, 16.5, 6000.0, 1650.0, null, 43),
  ('LECO', 'H-3', 'Hotel 3 – 11 kV and above', 'Hotel', null, 38.0, 18.0, 15.5, 6000.0, 1600.0, null, 44),
  ('LECO', 'GV-1A', 'Government 1 – up to 180 kWh a month (400/230 V, up to 42 kVA)', 'Government', 34.5, null, null, null, 600.0, null, null, 45),
  ('LECO', 'GV-1B', 'Government 1 – above 180 kWh a month (400/230 V, up to 42 kVA)', 'Government', 45.0, null, null, null, 1900.0, null, null, 46),
  ('LECO', 'GV-2', 'Government 2 – 400/230 V, above 42 kVA', 'Government', null, 78.0, 54.0, 40.0, 6000.0, 1800.0, null, 47),
  ('LECO', 'GV-3', 'Government 3 – 11 kV and above', 'Government', null, 77.0, 53.0, 39.0, 6000.0, 1700.0, null, 48),
  ('LECO', 'SL', 'Street lighting', 'Street lighting', 60.0, null, null, null, null, null, null, 49),
  ('LECO', 'AGR', 'Agriculture – optional time of use', 'Agriculture', null, 28.0, 14.0, 8.0, 750.0, null, null, 50),
  ('LECO', 'EVC-1', 'EV charging 1 – 400/230 V, up to 42 kVA', 'EV charging', null, 70.0, 15.0, 31.0, 1600.0, null, null, 51),
  ('LECO', 'EVC-2', 'EV charging 2 – above 42 kVA', 'EV charging', null, 70.0, 15.0, 31.0, 5000.0, 1500.0, null, 52),
  ('LECO', 'PP-D1', 'Pre-paid domestic – up to 90 kWh a month', 'Pre-paid (LECO)', 17.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 53),
  ('LECO', 'PP-D2', 'Pre-paid domestic – above 90 kWh a month', 'Pre-paid (LECO)', 93.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 54),
  ('LECO', 'PP-R1', 'Pre-paid religious – up to 90 kWh a month', 'Pre-paid (LECO)', 8.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 55),
  ('LECO', 'PP-R2', 'Pre-paid religious – above 90 kWh a month', 'Pre-paid (LECO)', 36.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 56),
  ('LECO', 'PP-GP1', 'Pre-paid general purpose (GP-1)', 'Pre-paid (LECO)', 38.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 57),
  ('LECO', 'PP-I1', 'Pre-paid industrial (I-1)', 'Pre-paid (LECO)', 19.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 58),
  ('LECO', 'PP-H1', 'Pre-paid hotel (H-1)', 'Pre-paid (LECO)', 19.0, null, null, null, null, null, 'Optional pre-paid scheme for LECO retail consumers', 59)
) v(supplier, code, name, family, rate, peak, day, off_peak, fixed, demand, note, sort)
on conflict (supplier, code) do update set name = excluded.name, family = excluded.family, rate = excluded.rate, peak = excluded.peak, day = excluded.day,
  off_peak = excluded.off_peak, fixed = excluded.fixed, demand = excluded.demand, note = excluded.note, sort = excluded.sort,
  effective_from = excluded.effective_from, active = true, updated_at = now();
