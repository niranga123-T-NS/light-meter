# Deployment

The system has three parts:

1. **Database, auth and file storage**: a Supabase project (PostgreSQL). The schema is in `supabase/migrations`.
2. **Edge Functions**: `admin-users`, `scheduled-export` and `daily-alerts` in `supabase/functions`.
3. **App**: one Expo codebase that builds the iOS and Android app for salespeople and the web dashboard for managers and administrators.

## 1. Supabase project

1. Create a project at supabase.com. Choose a region close to Sri Lanka (for example Singapore, `ap-southeast-1`) and the **Pro** plan or higher, so that Point-in-Time Recovery is available.
2. **Auth › Providers**: keep Email enabled and turn **off** "Allow new users to sign up". Users are invited by administrators.
3. Apply the schema from this repository:

   ```bash
   npx supabase login
   npx supabase init            # creates supabase/config.toml; keeps the existing migrations
   npx supabase link --project-ref <project-ref>
   npx supabase db push         # applies supabase/migrations/*.sql in order
   ```

   Do **not** run `supabase/seed.sql` in production. It creates demo users.
4. **Create the first administrator.** In Auth › Users, click Add user (email and password), then run this in the SQL editor:

   ```sql
   update public.profiles set role = 'admin', active = true, full_name = 'Your Name' where email = 'you@dimolanka.com';
   ```

   From then on, invite everyone else in the app (More › Users and roles).
5. Review **Admin › Settings** in the app: base currency, `gps_required`, `margin_visible_roles`, retention, and exchange rates.

## 2. Edge Functions and schedules

```bash
npx supabase functions deploy admin-users
npx supabase functions deploy scheduled-export --no-verify-jwt
npx supabase functions deploy daily-alerts --no-verify-jwt
npx supabase secrets set CRON_SECRET=<long random string>
# optional e-mail delivery (alerts and scheduled exports) through Resend
npx supabase secrets set RESEND_API_KEY=<key> ALERT_FROM_EMAIL="DIMO Sales <sales-app@yourdomain>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are provided to functions automatically.

Enable the `pg_cron` and `pg_net` extensions (Database › Extensions), then schedule the jobs in the SQL editor. Replace `<ref>` and `<CRON_SECRET>`:

```sql
-- Daily alerts and escalations, 07:30 Colombo (02:00 UTC)
select cron.schedule('dimo-daily-alerts', '0 2 * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb)
$$);

-- Scheduled Excel exports: checked hourly, each schedule runs when due
select cron.schedule('dimo-scheduled-exports', '5 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/scheduled-export',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb)
$$);

-- Retention clean-up, 02:00 Colombo
select cron.schedule('dimo-retention', '30 20 * * *', $$ select public.purge_expired() $$);
```

## 3. Microsoft 365 sign-in (optional)

1. In Microsoft Entra ID, register an application. Add the redirect URI `https://<ref>.supabase.co/auth/v1/callback` and create a client secret.
2. In Supabase, go to Auth › Providers › **Azure**. Enter the client ID and secret and the tenant URL (`https://login.microsoftonline.com/<tenant-id>`).
3. Under Auth › URL configuration, add the redirect URLs `dimosales://sign-in` (mobile) and your web dashboard URL.
4. Build the app with `EXPO_PUBLIC_MICROSOFT_SSO=true`.

Users signing in with Microsoft for the first time get an **inactive** profile until an administrator assigns their role and territories.

## 4. The app

Copy `.env.example` to `.env` and set:

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
EXPO_PUBLIC_MICROSOFT_SSO=false
```

The anon key is safe to ship in the app because every permission is enforced by row-level security.

**Mobile (EAS):**

```bash
npx eas-cli@latest login
npx eas-cli@latest init                          # links the project and adds extra.eas.projectId (enables push alerts)
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production
npx eas-cli@latest env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <key> --environment production
npx eas-cli@latest build --profile preview --platform all      # internal test builds
npx eas-cli@latest build --profile production --platform all   # store builds
npx eas-cli@latest submit
```

The bundle identifier and package name are `lk.dimo.sales` (in `app.json`); change them if DIMO uses a different namespace. For internal distribution without the stores, use the `preview` profile, which produces an Android APK and iOS ad-hoc builds.

**Web dashboard:**

```bash
npx expo export --platform web      # outputs dist/
```

Host `dist/` on any static host (EAS Hosting via `npx eas-cli@latest deploy`, Azure Static Web Apps, Netlify and so on). Configure all paths to fall back to `index.html`.

Over-the-air updates for JavaScript-only changes: `npx eas-cli@latest update --channel production`.

## 5. Backup and restore

* Point-in-Time Recovery (Supabase Pro add-on) targets RPO ≤ 5 minutes. Restore from Database › Backups.
* Weekly logical copy to DIMO-owned storage:

  ```bash
  npx supabase db dump --linked -f dimo_schema.sql
  npx supabase db dump --linked --data-only -f dimo_data.sql
  ```

  Restore into a fresh project with `psql -f dimo_schema.sql` followed by `psql -f dimo_data.sql`.
* Storage files (the `attachments` and `exports` buckets) can be copied with the Supabase CLI or S3-compatible tooling.

## 6. Local development

```bash
npm install
npx supabase start                  # local Supabase in Docker (applies migrations + seed.sql)
cp .env.example .env                # use the local URL/key printed by `supabase start`
npx expo start                      # press i / a / w for iOS, Android, web
```

Demo users from `seed.sql` all use the password `Dimo#2026`: admin@, manager@, sales1@ (Western), sales2@ (Central) and estimator@dimo.test.

The iPhone and Android apps need a **development build** (`npx expo run:ios|android` or `eas build --profile development`) for the camera, location and notification modules. Expo Go can be used for quick UI checks.
