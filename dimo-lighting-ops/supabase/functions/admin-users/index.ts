// User administration for the System Administrator (SRS Section 2): invite a user with a role,
// deactivate (never delete) and reactivate logins. Requires the caller to be an active sys_admin.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = [
  'gm', 'sm_projects', 'asm_building', 'asm_infra', 'design_manager', 'lighting_designer', 'lighting_engineer',
  'sm_estimation', 'am_estimation', 'estimation_exec', 'operations_exec', 'sys_admin',
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling?
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: caller } = await admin.auth.getUser(jwt);
  if (!caller.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single();
  if (!me || !me.active || me.role !== 'sys_admin') return json({ error: 'Only the System Administrator can manage users' }, 403);

  const body = await req.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'invite': {
        const email = String(body.email ?? '').trim().toLowerCase();
        if (!email || !body.full_name || !ROLES.includes(body.role)) return json({ error: 'Email, full name and a valid role are required' }, 400);
        const redirectTo = Deno.env.get('APP_URL') ? `${Deno.env.get('APP_URL')}/` : undefined;
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: body.full_name } });
        if (error) return json({ error: error.message }, 400);
        const { error: pe } = await admin.from('profiles').insert({
          id: data.user.id,
          email,
          full_name: body.full_name,
          role: body.role,
          manager_id: body.manager_id || null,
          phone: body.phone || null,
        });
        if (pe) return json({ error: pe.message }, 400);
        await admin.from('audit_log').insert({ user_id: caller.user.id, table_name: 'users', record_id: data.user.id, action: 'INVITE', new_data: { email, role: body.role } });
        return json({ id: data.user.id });
      }
      case 'deactivate':
      case 'activate': {
        const active = body.action === 'activate';
        if (!body.user_id) return json({ error: 'user_id is required' }, 400);
        if (body.user_id === caller.user.id) return json({ error: 'You cannot deactivate yourself' }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: active ? 'none' : '876000h' });
        if (error) return json({ error: error.message }, 400);
        await admin.from('profiles').update({ active }).eq('id', body.user_id);
        await admin.from('audit_log').insert({ user_id: caller.user.id, table_name: 'users', record_id: body.user_id, action: active ? 'ACTIVATE' : 'DEACTIVATE' });
        return json({ ok: true });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
