-- Dacademy Infrastructure: session 25 "Network builder: design and build" (public/academy/infra/builder.js) in a new module 5.
-- The learner builds a complete office from an empty room: add, cable, power, configure, test, document, then add/replace/remove devices.
insert into public.academy_lessons (course, module, lesson, kind) values
('infra','m5','infra_s25','session')
on conflict (lesson) do update set course = excluded.course, module = excluded.module, kind = excluded.kind;

update public.academy_badge_defs set rule = 'All 25 sessions and the module tests passed – certificate' where key = 'infra_gold';
