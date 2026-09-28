// Automated management alerts (Release 2).
// Called daily by pg_cron: escalates long-overdue actions, then sends each
// user a digest of overdue / due-soon actions (managers also get
// escalations, tender deadlines and pending corrections) by email and push.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, env, escapeHtml, isCronCall, json, sendEmail } from '../_shared/http.ts';

type Item = { code: string; description?: string; name?: string; due_date?: string; owner?: string;
  tender_closing_date?: string; quotation_due_date?: string };
type Digest = {
  user_id: string; email: string; name: string; role: string; push_tokens: string[];
  overdue: Item[]; due_soon: Item[]; escalated: Item[]; deadlines: Item[]; pending_corrections: number;
};

function list(title: string, items: Item[], fmt: (i: Item) => string): string {
  if (!items.length) return '';
  return `<h3>${escapeHtml(title)} (${items.length})</h3><ul>${items.map((i) => `<li>${fmt(i)}</li>`).join('')}</ul>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isCronCall(req)) return json({ error: 'Forbidden' }, 403);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const esc = await admin.rpc('escalate_overdue_actions');
  if (esc.error) return json({ error: esc.error.message }, 500);
  const res = await admin.rpc('alert_digests');
  if (res.error) return json({ error: res.error.message }, 500);
  const setting = await admin.from('app_settings').select('value').eq('key', 'alert_email_enabled').maybeSingle();
  const emailEnabled = setting.data?.value !== false;

  const digests = (res.data ?? []) as Digest[];
  let emails = 0;
  const pushMessages: unknown[] = [];

  for (const d of digests) {
    const html =
      `<p>Hello ${escapeHtml(d.name)},</p>` +
      list('Overdue actions', d.overdue, (i) => `${escapeHtml(i.code)} – ${escapeHtml(i.description)} (due ${escapeHtml(i.due_date)})`) +
      list('Due soon', d.due_soon, (i) => `${escapeHtml(i.code)} – ${escapeHtml(i.description)} (due ${escapeHtml(i.due_date)})`) +
      list('Escalated to you', d.escalated, (i) => `${escapeHtml(i.code)} – ${escapeHtml(i.description)} – ${escapeHtml(i.owner)} (due ${escapeHtml(i.due_date)})`) +
      list('Tender / quotation deadlines this week', d.deadlines,
        (i) => `${escapeHtml(i.code)} ${escapeHtml(i.name)} – tender ${escapeHtml(i.tender_closing_date ?? '–')}, quotation ${escapeHtml(i.quotation_due_date ?? '–')}`) +
      (d.pending_corrections ? `<p>${d.pending_corrections} visit correction(s) are waiting for approval.</p>` : '');
    if (emailEnabled && d.email) {
      try {
        if (await sendEmail([d.email], 'DIMO Sales – your daily follow-ups', html)) emails++;
      } catch (e) {
        console.error('email', d.email, e);
      }
    }
    const count = d.overdue.length + d.escalated.length;
    for (const token of d.push_tokens ?? []) {
      pushMessages.push({
        to: token,
        title: count ? `${count} overdue follow-up${count === 1 ? '' : 's'}` : 'Follow-ups due soon',
        body: [d.overdue[0], d.due_soon[0], d.escalated[0]].filter(Boolean).map((i) => i!.description).join(' · ').slice(0, 170),
        data: { url: '/actions' },
      });
    }
  }

  let pushed = 0;
  for (let i = 0; i < pushMessages.length; i += 100) {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(pushMessages.slice(i, i + 100)),
    });
    if (r.ok) pushed += Math.min(100, pushMessages.length - i);
  }

  return json({ escalated: esc.data, digests: digests.length, emails, pushed });
});
