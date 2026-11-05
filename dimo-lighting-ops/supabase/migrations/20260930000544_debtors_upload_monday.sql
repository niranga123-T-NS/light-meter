-- The weekly debtors list is uploaded on Monday: the Operations Executive is reminded on Monday 09:00; not confirmed on Monday →
-- SM Projects and the DGM are told on Tuesday 09:00. Changed in the current definition of reminders_tick.
do $$
declare src text; a int; b int; endm text := 'format(''debtupmiss:%s'', today));' || chr(10) || '  end if;';
begin
  src := pg_get_functiondef('public.reminders_tick'::regproc);
  a := position('-- Debtors upload reminder Saturday' in src);
  b := position(endm in src);
  if a = 0 or b = 0 or b < a then raise exception 'debtors upload reminder block not found'; end if;
  src := substring(src from 1 for a - 1) || $blk$-- Debtors upload reminder Monday 09:00; not confirmed on Monday → SM Projects and GM on Tuesday 09:00 (12.2)
  if dow = 1 and t >= time '09:00' and not exists (select 1 from public.debt_uploads where status = 'confirmed' and (confirmed_at at time zone tz)::date >= today) then
    perform app.notify_many(app.role_users('operations_exec'), 'debtors_upload_reminder', 'Upload this week''s debtors list',
      'Due today (Monday)', 'normal', null, null, '/debtors/upload', format('debtup:%s', today));
  end if;
  if dow = 2 and t >= time '09:00' and not exists (select 1 from public.debt_uploads where status = 'confirmed' and (confirmed_at at time zone tz)::date >= today - 1) then
    perform app.notify_many(app.role_users('sm_projects') || app.role_users('gm'), 'debtors_upload_missed', 'Debtors list not uploaded',
      'The Monday debtors upload was missed', 'normal', null, null, '/debtors', format('debtupmiss:%s', today));
  end if;$blk$ || substring(src from b + length(endm));
  execute src;
end $$;
