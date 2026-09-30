-- Scheduler (SRS 10.4: "scheduled job every 15 minutes evaluating open clocks").
-- Uses pg_cron + pg_net on Supabase. The push dispatcher Edge Function is called every minute.
-- Before this works, store two secrets in Supabase Vault (see docs/IMPLEMENTATION_GUIDE.md):
--   project_url       e.g. https://abcd.supabase.co
--   dispatch_secret   the same value as the DISPATCH_SECRET Edge Function secret

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;

    perform cron.schedule('sla-tick', '*/15 * * * *', 'select public.sla_tick()');
    perform cron.schedule('reminders-tick', '*/15 * * * *', 'select public.reminders_tick()');
    perform cron.schedule('push-dispatch', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push-dispatch',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000)
      where exists (select 1 from public.notifications where pushed_at is null and deliver_after <= now())
    $job$);
  else
    raise notice 'pg_cron / pg_net not available – schedule sla_tick(), reminders_tick() and push-dispatch externally';
  end if;
end $$;
