// User administration for the System Administrator (SRS Section 2): invite a user with a role,
// deactivate (never delete) and reactivate logins. Requires the caller to be an active sys_admin.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = [
  'gm', 'sm_projects', 'asm_building', 'asm_infra', 'design_manager', 'lighting_designer', 'lighting_engineer', 'senior_elec_engineer', 'assistant_engineer', 'trainee', 'sub_supervisor',
  'sm_estimation', 'am_estimation', 'estimation_exec', 'operations_exec', 'sys_admin',
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Who is calling?
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: caller, error: authError } = await admin.auth.getUser(jwt);
  if (!caller?.user) return json({ error: `Not signed in${authError ? `: ${authError.message}` : ''}` }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', caller.user.id).single();
  const body = await req.json().catch(() => ({}));

  // Execution access: the login of an approved temporary staff member or subcontractor supervisor, created by the
  // Senior Electrical Engineer, SM Projects or DGM / GM. The approval is checked in the database.
  if (body.action === 'provision') {
    if (!me || !me.active || !['senior_elec_engineer', 'sm_projects', 'gm', 'sys_admin'].includes(me.role)) {
      return json({ error: 'Only the Senior Electrical Engineer, SM Projects or DGM / GM create these logins' }, 403);
    }
    const { data: r } = await admin.from('access_requests').select('*').eq('id', body.request_id).maybeSingle();
    if (!r || r.status !== 'approved' || !['temp_add', 'sub_appoint'].includes(r.kind)) return json({ error: 'The request is not approved yet or already done' }, 400);
    const phone = String(r.phone ?? '').replace(/[^0-9]/g, '');
    const email = r.email ? String(r.email).toLowerCase() : phone ? `${phone}@users.dimo-lighting-ops.app` : '';
    if (!email) return json({ error: 'The request has no email or mobile number' }, 400);
    const password = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[b % 56]).join('') + '7';
    const res = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: r.person_name } });
    if (res.error) return json({ error: res.error.message }, 400);
    const uid = res.data.user.id;
    const { error: pe } = await admin.from('profiles').insert({
      id: uid,
      email,
      full_name: r.person_name,
      role: r.role_type,
      manager_id: r.requested_by,
      phone: r.phone,
    });
    if (pe) {
      await admin.auth.admin.deleteUser(uid);
      return json({ error: pe.message }, 400);
    }
    const { error: ce } = await admin.rpc('complete_access_provision', { p_request: r.id, p_user: uid });
    if (ce) return json({ error: ce.message }, 400);
    await admin.from('audit_log').insert({ user_id: caller.user.id, table_name: 'users', record_id: uid, action: 'PROVISION', new_data: { role: r.role_type, request: r.code } });
    // The temporary password is shown once to the person creating the login, to hand over
    return json({ id: uid, login: r.email ? email : phone, password });
  }

  if (!me || !me.active || me.role !== 'sys_admin') return json({ error: 'Only the System Administrator can manage users' }, 403);
  try {
    switch (body.action) {
      case 'invite': {
        const email = String(body.email ?? '').trim().toLowerCase();
        if (!email || !body.full_name || !ROLES.includes(body.role)) return json({ error: 'Email, full name and a valid role are required' }, 400);
        // With a temporary password the account is ready at once (no email needed);
        // otherwise an invitation email is sent (needs working SMTP for non-team addresses).
        let data;
        if (body.password) {
          if (String(body.password).length < 8) return json({ error: 'Temporary password must be at least 8 characters' }, 400);
          const res = await admin.auth.admin.createUser({ email, password: String(body.password), email_confirm: true, user_metadata: { full_name: body.full_name } });
          if (res.error) return json({ error: res.error.message }, 400);
          data = res.data;
        } else {
          const redirectTo = Deno.env.get('APP_URL') ? `${Deno.env.get('APP_URL')}/` : undefined;
          const res = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: body.full_name } });
          if (res.error) return json({ error: res.error.message }, 400);
          data = res.data;
        }
        const { error: pe } = await admin.from('profiles').insert({
          id: data.user.id,
          email,
          full_name: body.full_name,
          role: body.role,
          manager_id: body.manager_id || null,
          phone: body.phone || null,
        });
        if (pe) {
          await admin.auth.admin.deleteUser(data.user.id); // don't leave a login without a role
          return json({ error: pe.message }, 400);
        }
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
