// Push dispatcher (SRS 8.4 / 8.7): sends queued notifications to the mobile app through the Expo Push
// service (which delivers via FCM on Android and APNs on iOS). Called every minute by pg_cron.
// Quiet-hours items are queued with a later deliver_after, so they arrive here at 07:00 and are
// grouped into a single digest push per user. Nothing is ever sent to external contacts.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.headers.get('x-dispatch-secret') !== Deno.env.get('DISPATCH_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

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
  const { data: tokens } = await db.from('push_tokens').select('token, user_id').in('user_id', recipients);
  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const messages: Record<string, unknown>[] = [];
  for (const user of recipients) {
    const mine = notes.filter((n) => n.recipient_id === user);
    const to = byUser.get(user) ?? [];
    if (!to.length) continue; // in-app list only (e.g. web-only users)
    const critical = mine.filter((n) => n.priority === 'critical');
    const normal = mine.filter((n) => n.priority !== 'critical');
    for (const n of critical) {
      messages.push({ to, title: n.title, body: n.body, data: { url: n.url, id: n.id }, priority: 'high', channelId: 'critical', sound: 'default' });
    }
    if (normal.length > 3) {
      // Held notices (quiet hours / daily digest) arrive together – send one grouped push
      messages.push({
        to,
        title: `${normal.length} new notifications`,
        body: normal.slice(0, 4).map((n) => `• ${n.title}`).join('\n'),
        data: { url: '/notifications' },
        channelId: 'default',
      });
    } else {
      for (const n of normal) {
        messages.push({ to, title: n.resent_at ? `Reminder: ${n.title}` : n.title, body: n.body, data: { url: n.url, id: n.id }, channelId: 'default' });
      }
    }
  }

  const invalid: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
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
    // Remove tokens for uninstalled apps
    (json.data ?? []).forEach((ticket: { status: string; details?: { error?: string } }, k: number) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const to = chunk[k].to as string[];
        invalid.push(...to);
      }
    });
  }
  if (invalid.length) await db.from('push_tokens').delete().in('token', invalid);

  await db.from('notifications').update({ pushed_at: new Date().toISOString() }).in('id', notes.map((n) => n.id));
  return Response.json({ notifications: notes.length, pushes: messages.length, removed_tokens: invalid.length });
});
