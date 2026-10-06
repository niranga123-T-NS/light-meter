// Push dispatcher (SRS 8.4 / 8.7): sends queued notifications to the mobile app through the Expo Push
// service (which delivers via FCM on Android and APNs on iOS) and to browsers / home-screen web apps
// (including iPhone and iPad, iOS 16.4+) through standard Web Push. Called every minute by pg_cron.
// Quiet-hours items are queued with a later deliver_after, so they arrive here at 07:00 and are
// grouped into a single digest push per user. Nothing is ever sent to external contacts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Note = {
  id: string;
  recipient_id: string;
  title: string;
  body: string;
  priority: 'normal' | 'critical';
  url: string | null;
  resent_at: string | null;
};

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(Deno.env.get('APP_URL') ?? 'https://dimo-lighting-ops.vercel.app', VAPID_PUBLIC, VAPID_PRIVATE);

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  // The web portal asks for the public Web Push key (public by design – no secret needed)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET' || new URL(req.url).searchParams.has('vapid')) {
    return Response.json({ vapidPublicKey: VAPID_PUBLIC || null }, { headers: cors });
  }
  if (req.headers.get('x-dispatch-secret') !== Deno.env.get('DISPATCH_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Execution access: block the login of removed supervisors and deleted temporary staff; unblock a supervisor appointed again
  try {
    const { data: block } = await db.from('profiles').select('id').eq('revoke_pending', true).limit(50);
    for (const u of block ?? []) {
      const { error: be } = await db.auth.admin.updateUserById(u.id, { ban_duration: '876000h' });
      if (!be) await db.rpc('mark_banned', { p_user: u.id });
    }
    const { data: unblock } = await db.from('profiles').select('id').eq('active', true).not('banned_at', 'is', null).limit(50);
    for (const u of unblock ?? []) {
      const { error: ue } = await db.auth.admin.updateUserById(u.id, { ban_duration: 'none' });
      if (!ue) await db.rpc('mark_unbanned', { p_user: u.id });
    }
  } catch (e) {
    console.error('access sweep', e);
  }

  const { data: due, error } = await db
    .from('notifications')
    .select('id, recipient_id, title, body, priority, url, resent_at')
    .is('pushed_at', null)
    .lte('deliver_after', new Date().toISOString())
    .order('created_at')
    .limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const notes = (due ?? []) as Note[];
  if (!notes.length) return Response.json({ sent: 0 });

  const recipients = [...new Set(notes.map((n) => n.recipient_id))];
  const { data: tokens } = await db.from('push_tokens').select('token, user_id, platform').in('user_id', recipients);
  const byUser = new Map<string, { expo: string[]; web: string[] }>();
  for (const t of tokens ?? []) {
    const entry = byUser.get(t.user_id) ?? { expo: [], web: [] };
    (t.platform === 'web' ? entry.web : entry.expo).push(t.token);
    byUser.set(t.user_id, entry);
  }

  // What each user should receive (critical ones individually; more than 3 normal ones grouped)
  type Push = { user: string; title: string; body: string; url: string | null; id?: string; critical: boolean };
  const pushes: Push[] = [];
  for (const user of recipients) {
    if (!byUser.has(user)) continue; // in-app list only
    const mine = notes.filter((n) => n.recipient_id === user);
    const critical = mine.filter((n) => n.priority === 'critical');
    const normal = mine.filter((n) => n.priority !== 'critical');
    for (const n of critical) pushes.push({ user, title: n.title, body: n.body, url: n.url, id: n.id, critical: true });
    if (normal.length > 3) {
      // Held notices (quiet hours / daily digest) arrive together – send one grouped push
      pushes.push({ user, title: `${normal.length} new notifications`, body: normal.slice(0, 4).map((n) => `• ${n.title}`).join('\n'), url: '/notifications', critical: false });
    } else {
      for (const n of normal) pushes.push({ user, title: n.resent_at ? `Reminder: ${n.title}` : n.title, body: n.body, url: n.url, id: n.id, critical: false });
    }
  }

  const invalid: string[] = [];
  const errors: string[] = [];

  // Mobile app (Expo push → FCM / APNs): one message per device token
  const expoMessages = pushes.flatMap((p) =>
    (byUser.get(p.user)?.expo ?? []).map((to) => ({
      to,
      title: p.title,
      body: p.body,
      data: { url: p.url, id: p.id },
      channelId: p.critical ? 'critical' : 'default',
      ...(p.critical ? { priority: 'high', sound: 'default' } : {}),
    })),
  );
  for (let i = 0; i < expoMessages.length; i += 100) {
    const chunk = expoMessages.slice(i, i + 100);
    const res = await fetch(EXPO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) errors.push(`Expo push service HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    (json.data ?? []).forEach((ticket: { status: string; message?: string; details?: { error?: string } }, k: number) => {
      if (ticket.status !== 'error') return;
      // Remove tokens for uninstalled apps; report anything else (e.g. InvalidCredentials = FCM key missing on expo.dev)
      if (ticket.details?.error === 'DeviceNotRegistered') invalid.push(chunk[k].to);
      else errors.push(`${ticket.details?.error ?? 'error'}: ${ticket.message ?? ''}`.slice(0, 300));
    });
  }

  // Browsers and home-screen web apps (Web Push with VAPID)
  let webSent = 0;
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    const jobs = pushes.flatMap((p) => (byUser.get(p.user)?.web ?? []).map((token) => ({ p, token })));
    await Promise.all(
      jobs.map(async ({ p, token }) => {
        try {
          await webpush.sendNotification(JSON.parse(token), JSON.stringify({ title: p.title, body: p.body, url: p.url, id: p.id }), {
            TTL: 24 * 3600,
            urgency: p.critical ? 'high' : 'normal',
          });
          webSent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) invalid.push(token); // subscription expired or removed
          else errors.push(`web push ${status ?? ''}: ${String((e as Error).message ?? e)}`.slice(0, 300));
        }
      }),
    );
  } else if (pushes.some((p) => byUser.get(p.user)?.web.length)) {
    errors.push('web push skipped: VAPID keys are not set');
  }

  if (errors.length) console.error('push-dispatch errors', errors);
  if (invalid.length) await db.from('push_tokens').delete().in('token', invalid);

  await db.from('notifications').update({ pushed_at: new Date().toISOString() }).in('id', notes.map((n) => n.id));
  return Response.json({ notifications: notes.length, expo: expoMessages.length, web: webSent, removed_tokens: invalid.length, errors });
});
