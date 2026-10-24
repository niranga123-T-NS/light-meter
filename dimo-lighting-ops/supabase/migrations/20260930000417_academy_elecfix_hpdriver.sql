-- Dacademy Electrical Troubleshooting: the high-power 1700 W 3-channel DMX driver workbench and the "works, trips, dead after reset" case
-- (public/academy/elec/hpdriver.js). Both are labs in the LED drivers module, so they also count for the workshop badge.
insert into public.academy_lessons (course, module, lesson, kind) values
('elecfix','driver','ef_d_hp','lab'),
('elecfix','driver','ef_d_hptrip','lab')
on conflict (lesson) do update set course = excluded.course, module = excluded.module, kind = excluded.kind;
