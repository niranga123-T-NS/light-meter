// Scheduled Excel export (Release 2).
// Called hourly by pg_cron (see docs/DEPLOYMENT.md). For every active row in
// export_schedules that is due, it builds the workbook *as the schedule's
// creator* (so row-level security and margin visibility apply exactly as in
// the app), stores it in the private "exports" bucket and emails a
// time-limited download link to the recipients.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildExportWorkbook, exportFileName, type ExportDataset } from '../_shared/workbook.ts';
import { corsHeaders, env, escapeHtml, isCronCall, json, sendEmail } from '../_shared/http.ts';

type Schedule = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  last_run_at: string | null;
  created_by: string;
};

const DAY = 86400000;
const colomboToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

/** Resolve a relative "period" filter into from/to dates (Asia/Colombo). */
export function resolvePeriod(filters: Record<string, unknown>, frequency: Schedule['frequency']): Record<string, unknown> {
  const { period, ...rest } = filters as { period?: string };
  const today = colomboToday();
  const p = period ?? (frequency === 'daily' ? 'previous_day' : frequency === 'weekly' ? 'previous_7_days' : 'previous_month');
  switch (p) {
    case 'previous_day': return { ...rest, from: addDays(today, -1), to: addDays(today, -1) };
    case 'previous_7_days': return { ...rest, from: addDays(today, -7), to: addDays(today, -1) };
    case 'previous_month': {
      const first = today.slice(0, 8) + '01';
      const prevLast = addDays(first, -1);
      return { ...rest, from: prevLast.slice(0, 8) + '01', to: prevLast };
    }
    case 'month_to_date': return { ...rest, from: today.slice(0, 8) + '01', to: today };
    case 'year_to_date': return { ...rest, from: today.slice(0, 5) + '01-01', to: today };
    default: return rest;
  }
}

function isDue(s: Schedule): boolean {
  if (!s.last_run_at) return true;
  const last = new Date(Date.parse(s.last_run_at) + 330 * 60000).toISOString().slice(0, 10);
  const today = colomboToday();
  if (s.frequency === 'daily') return last < today;
  if (s.frequency === 'weekly') return last <= addDays(today, -7);
  return last.slice(0, 7) < today.slice(0, 7);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isCronCall(req)) return json({ error: 'Forbidden' }, 403);

  const sql = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: 1 });
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const results: unknown[] = [];

  try {
    const schedules = await sql<Schedule[]>`
      select s.id, s.name, s.filters, s.frequency, s.recipients, s.last_run_at, s.created_by
      from public.export_schedules s join public.profiles p on p.id = s.created_by
      where s.active and p.active and p.role in ('manager', 'admin')`;

    for (const s of schedules) {
      if (!body.force && !isDue(s)) continue;
      try {
        const filters = resolvePeriod(s.filters ?? {}, s.frequency);
        const data = await sql.begin(async (tx) => {
          // Run as the schedule owner so RLS and role restrictions apply.
          await tx`select set_config('request.jwt.claim.sub', ${s.created_by}, true),
                          set_config('request.jwt.claims', ${JSON.stringify({ sub: s.created_by, role: 'authenticated' })}, true)`;
          await tx.unsafe('set local role authenticated');
          const [row] = await tx`select public.export_dataset(${tx.json(filters as never)}, 'scheduled') as d`;
          return row.d as ExportDataset & { export_id: string };
        });
        const bytes = buildExportWorkbook(data, { generatedByName: `Scheduled: ${s.name}` });
        const path = `scheduled/${s.id}/${exportFileName(data)}`;
        const up = await admin.storage.from('exports').upload(path, bytes, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true,
        });
        if (up.error) throw up.error;
        await sql`update public.export_log set storage_path = ${path}, schedule_id = ${s.id} where id = ${data.export_id}`;
        await sql`update public.export_schedules set last_run_at = now() where id = ${s.id}`;

        let emailed = false;
        if (s.recipients?.length) {
          const signed = await admin.storage.from('exports').createSignedUrl(path, 7 * 86400);
          if (signed.data?.signedUrl) {
            emailed = await sendEmail(s.recipients, `DIMO sales export – ${s.name}`,
              `<p>The scheduled export <b>${escapeHtml(s.name)}</b> is ready (${escapeHtml(filters.from ?? '')} to ${escapeHtml(filters.to ?? '')}).</p>` +
              `<p><a href="${signed.data.signedUrl}">Download the Excel workbook</a> (link valid for 7 days).</p>`);
          }
        }
        results.push({ schedule: s.id, path, rows: data.row_counts, emailed });
      } catch (e) {
        results.push({ schedule: s.id, error: String((e as Error).message ?? e) });
      }
    }
    return json({ ran: results.length, results });
  } finally {
    await sql.end();
  }
});
