// User administration for administrators (invite, change role/territories,
// deactivate / reactivate). Needs the service role, so it runs server side;
// the caller must be an active administrator.
//
// POST body:
//   { "action": "invite", "email": "...", "full_name": "...", "role": "salesperson",
//     "territory_ids": ["..."], "password": "optional temporary password" }
//   { "action": "update", "user_id": "...", "role": "...", "full_name": "...", "territory_ids": [...] }
//   { "action": "deactivate", "user_id": "...", "reassign_to": "optional user id" }
//   { "action": "reactivate", "user_id": "..." }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, env, json } from '../_shared/http.ts';

const ROLES = ['salesperson', 'manager', 'designer', 'estimator', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = env('SUPABASE_URL');
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // Identify the caller from their access token
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);
  const caller = await admin.from('profiles').select('role, active').eq('id', userData.user.id).single();
  if (caller.data?.role !== 'admin' || !caller.data.active) return json({ error: 'Administrator access required' }, 403);

  // Caller-scoped client so reassign_owner's admin check and the audit log see the real user
  const asCaller = createClient(url, env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const body = await req.json().catch(() => ({}));
  const setTerritories = async (userId: string, ids: unknown) => {
    if (!Array.isArray(ids)) return;
    await admin.from('profile_territories').delete().eq('user_id', userId);
    if (ids.length) {
      const ins = await admin.from('profile_territories').insert(ids.map((t) => ({ user_id: userId, territory_id: t })));
      if (ins.error) throw ins.error;
    }
  };

  try {
    switch (body.action) {
      case 'invite': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const role = ROLES.includes(body.role) ? body.role : 'salesperson';
        if (!email.includes('@')) return json({ error: 'A valid email is required' }, 400);
        const meta = { full_name: body.full_name ?? '' };
        const created = body.password
          ? await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: meta, app_metadata: { role, active: true } })
          : await admin.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo: body.redirect_to });
        if (created.error) return json({ error: created.error.message }, 400);
        const id = created.data.user!.id;
        await admin.auth.admin.updateUserById(id, { app_metadata: { role, active: true } });
        const up = await admin.from('profiles').upsert({ id, email, full_name: body.full_name ?? email.split('@')[0], role, active: true });
        if (up.error) throw up.error;
        await setTerritories(id, body.territory_ids);
        return json({ user_id: id });
      }
      case 'update': {
        const patch: Record<string, unknown> = {};
        if (body.role !== undefined) {
          if (!ROLES.includes(body.role)) return json({ error: 'Unknown role' }, 400);
          patch.role = body.role;
        }
        if (body.full_name !== undefined) patch.full_name = body.full_name;
        if (Object.keys(patch).length) {
          const up = await admin.from('profiles').update(patch).eq('id', body.user_id);
          if (up.error) throw up.error;
          if (patch.role) await admin.auth.admin.updateUserById(body.user_id, { app_metadata: { role: patch.role } });
        }
        await setTerritories(body.user_id, body.territory_ids);
        return json({ ok: true });
      }
      case 'deactivate': {
        if (body.user_id === userData.user.id) return json({ error: 'You cannot deactivate yourself' }, 400);
        let reassigned = null;
        if (body.reassign_to) {
          const r = await asCaller.rpc('reassign_owner', { p_from: body.user_id, p_to: body.reassign_to });
          if (r.error) return json({ error: r.error.message }, 400);
          reassigned = r.data;
        }
        const up = await admin.from('profiles').update({ active: false }).eq('id', body.user_id);
        if (up.error) throw up.error;
        await admin.auth.admin.updateUserById(body.user_id, { ban_duration: '876000h', app_metadata: { active: false } });
        await admin.from('device_push_tokens').delete().eq('user_id', body.user_id);
        return json({ ok: true, reassigned });
      }
      case 'reactivate': {
        const up = await admin.from('profiles').update({ active: true }).eq('id', body.user_id);
        if (up.error) throw up.error;
        await admin.auth.admin.updateUserById(body.user_id, { ban_duration: 'none', app_metadata: { active: true } });
        return json({ ok: true });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
