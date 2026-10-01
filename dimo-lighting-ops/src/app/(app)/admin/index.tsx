import { Stack } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Avatar, Button, Card, colors, ErrorBanner, ListRow, Muted, Notice, Pill, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { clearPeopleCache, loadMasters, useLoad } from '@/lib/hooks';
import { PROJECT_TYPES, ROLE_LABELS, ROLE_SHORT } from '@/lib/roles';
import { callFunction, rpc, supabase } from '@/lib/supabase';
import type { Profile, Role } from '@/lib/types';

type Tab = 'users' | 'masters' | 'sla' | 'settings' | 'calendar' | 'brands' | 'competitors';
const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** Administration: users and roles, master lists, SLA rules, settings, holidays, exchange rates, brands, competitors. */
export default function Admin() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('users');
  if (!['sys_admin', 'gm', 'sm_projects'].includes(me.role)) return <Screen><ErrorBanner message="Not available for your role." /></Screen>;
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Administration' }} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'users', label: 'Users' },
          { value: 'masters', label: 'Master lists' },
          { value: 'sla', label: 'SLA rules' },
          { value: 'settings', label: 'Settings' },
          { value: 'calendar', label: 'Holidays & rates' },
          { value: 'brands', label: 'Brands' },
          { value: 'competitors', label: 'Competitors' },
        ]}
      />
      {me.role !== 'sys_admin' && tab !== 'users' && tab !== 'competitors' ? (
        <Notice>Changes to SLA settings and master data are made by the System Administrator and approved by GM / DGM.</Notice>
      ) : null}
      {tab === 'users' ? <Users /> : null}
      {tab === 'masters' ? <Masters /> : null}
      {tab === 'sla' ? <SlaRules /> : null}
      {tab === 'settings' ? <Settings /> : null}
      {tab === 'calendar' ? <Calendar /> : null}
      {tab === 'brands' ? <Brands /> : null}
      {tab === 'competitors' ? <Competitors /> : null}
    </Screen>
  );
}

function Users() {
  const me = useMe();
  const dialog = useDialog();
  const admin = me.role === 'sys_admin';
  const { data, error, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('profiles').select('*').order('active', { ascending: false }).order('full_name');
    if (e) throw new Error(e.message);
    return rows as Profile[];
  });
  const people = data ?? [];

  const invite = async () => {
    const r = await dialog.prompt({
      title: 'New user',
      message: 'Give a temporary password and share it with the user (they change it under Profile). Leave it blank to send an invitation email instead.',
      fields: [
        { key: 'email', label: 'Work email', required: true },
        { key: 'password', label: 'Temporary password (min. 8 characters)' },
        { key: 'full_name', label: 'Full name', required: true },
        { key: 'role', label: 'Role', type: 'select', required: true, options: ROLES.map((r2) => ({ value: r2, label: ROLE_LABELS[r2] })) },
        { key: 'manager_id', label: 'Reports to', type: 'select', options: people.map((p) => ({ value: p.id, label: `${p.full_name} (${ROLE_SHORT[p.role]})` })) },
        { key: 'phone', label: 'Phone' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      await callFunction('admin-users', { action: 'invite', ...r, email: r.email.trim(), password: r.password || null, manager_id: r.manager_id || null });
      clearPeopleCache();
      await reload();
    }, r.password ? 'User created – share the email and temporary password' : 'Invitation sent');
  };

  const edit = async (p: Profile) => {
    const r = await dialog.prompt({
      title: p.full_name,
      fields: [
        { key: 'full_name', label: 'Full name', required: true, initial: p.full_name },
        { key: 'role', label: 'Role', type: 'select', required: true, initial: p.role, options: ROLES.map((r2) => ({ value: r2, label: ROLE_LABELS[r2] })) },
        { key: 'manager_id', label: 'Reports to', type: 'select', initial: p.manager_id ?? '', options: people.filter((x) => x.id !== p.id).map((x) => ({ value: x.id, label: x.full_name })) },
        { key: 'types', label: `Project types (comma separated: ${PROJECT_TYPES.map((t) => t.value).join(', ')})`, initial: p.project_types.join(', ') },
        { key: 'phone', label: 'Phone', initial: p.phone ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('profiles')
        .update({
          full_name: r.full_name,
          role: r.role,
          manager_id: r.manager_id || null,
          phone: r.phone || null,
          project_types: r.types.split(',').map((x) => x.trim()).filter(Boolean),
        })
        .eq('id', p.id);
      if (e) throw new Error(e.message);
      clearPeopleCache();
      await reload();
    }, 'Saved – changes apply at next login');
  };

  const transfer = async (p: Profile) => {
    const r = await dialog.prompt({
      title: `Transfer ${p.full_name}'s accounts`,
      message: 'Customers, units, open projects, inquiries, plan lines and debtors move in one step. History stays with the original person. The login is deactivated, never deleted.',
      fields: [
        { key: 'to', label: 'Receiving sales person', type: 'select', required: true, options: people.filter((x) => x.active && x.id !== p.id && ['asm_building', 'asm_infra'].includes(x.role)).map((x) => ({ value: x.id, label: x.full_name })) },
        { key: 'deactivate', label: 'Deactivate the leaving user?', type: 'select', initial: 'yes', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No (role change)' }] },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const res = await rpc<Record<string, number>>('transfer_accounts', { p_from: p.id, p_to: r.to, p_deactivate: r.deactivate === 'yes' });
      dialog.toast(`Moved ${res.organizations} organizations, ${res.units} units, ${res.projects} projects`);
      await reload();
    });
  };

  return (
    <Section title={`Users (${people.length})`} right={admin ? <Button small title="+ Invite user" onPress={invite} /> : undefined}>
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {people.map((p) => (
          <ListRow
            key={p.id}
            left={<Avatar name={p.full_name} path={p.avatar_path} />}
            title={p.full_name}
            subtitle={`${ROLE_LABELS[p.role]} · ${p.email ?? ''} · reports to ${people.find((x) => x.id === p.manager_id)?.full_name ?? '—'}`}
            right={
              <Row gap={4} wrap>
                {!p.active ? <Pill label="Inactive" tone={colors.grey} /> : null}
                {admin ? <Button small variant="ghost" title="Edit" onPress={() => edit(p)} /> : null}
                {admin && p.avatar_path ? (
                  <Button small variant="ghost" title="Remove picture" onPress={() => dialog.run(async () => { await supabase.from('profiles').update({ avatar_path: null }).eq('id', p.id); await reload(); }, 'Picture removed')} />
                ) : null}
                {admin ? (
                  <Button
                    small
                    variant="ghost"
                    title={p.active ? 'Deactivate' : 'Activate'}
                    onPress={() =>
                      dialog.run(async () => {
                        await callFunction('admin-users', { action: p.active ? 'deactivate' : 'activate', user_id: p.id });
                        await reload();
                      })
                    }
                  />
                ) : null}
                {(me.role === 'sm_projects' || me.role === 'gm') && ['asm_building', 'asm_infra'].includes(p.role) && p.active ? (
                  <Button small variant="secondary" title="Transfer accounts" onPress={() => transfer(p)} />
                ) : null}
              </Row>
            }
          />
        ))}
      </Card>
    </Section>
  );
}

function Masters() {
  const me = useMe();
  const dialog = useDialog();
  const [list, setList] = useState('visit_category');
  const { data, reload } = useLoad(async () => {
    const { data: rows } = await supabase.from('master_lists').select('*').eq('list_name', list).order('sort_order');
    return (rows ?? []) as { id: number; value: string; grp: string | null; active: boolean; sort_order: number }[];
  }, [list]);
  const names = ['visit_category', 'visit_objective', 'visit_outcome', 'project_stage', 'missed_reason', 'lost_reason', 'tender_activity', 'sample_purpose', 'hold_reason', 'delay_reason', 'debt_dispute_reason'];
  return (
    <Section title="Master lists" right={me.role === 'sys_admin' ? <Button small title="+ Value" onPress={async () => {
      const r = await dialog.prompt({ title: `Add to ${list}`, fields: [{ key: 'v', label: 'Value', required: true }, { key: 'g', label: 'Group (objectives)' }] });
      if (r) await dialog.run(async () => { const { error } = await supabase.from('master_lists').insert({ list_name: list, value: r.v, grp: r.g || null, sort_order: (data?.length ?? 0) + 1 }); if (error) throw new Error(error.message); await loadMasters(true); await reload(); }, 'Added');
    }} /> : undefined}>
      <Segmented value={list} onChange={setList} options={names.map((n) => ({ value: n, label: n.replace(/_/g, ' ') }))} />
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        {(data ?? []).map((m) => (
          <ListRow
            key={m.id}
            title={m.value}
            subtitle={m.grp ?? undefined}
            right={
              me.role === 'sys_admin' ? (
                <Button small variant="ghost" title={m.active ? 'Deactivate' : 'Activate'} onPress={() => dialog.run(async () => { await supabase.from('master_lists').update({ active: !m.active }).eq('id', m.id); await loadMasters(true); await reload(); })} />
              ) : (
                <Pill label={m.active ? 'Active' : 'Inactive'} />
              )
            }
          />
        ))}
      </Card>
    </Section>
  );
}

function SlaRules() {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const { data: rows } = await supabase.from('sla_rules').select('*').order('stage');
    return (rows ?? []) as { stage: string; label: string; target_minutes: number }[];
  });
  return (
    <Section title="SLA defaults (working hours; 1 working day = 9 h)">
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((r) => (
          <ListRow
            key={r.stage}
            title={r.label}
            subtitle={r.stage}
            right={
              <Row gap={6}>
                <Pill label={`${(r.target_minutes / 60).toFixed(1)} h`} />
                {['sys_admin', 'gm'].includes(me.role) ? (
                  <Button
                    small
                    variant="ghost"
                    title="Edit"
                    onPress={async () => {
                      const x = await dialog.prompt({ title: r.label, fields: [{ key: 'h', label: 'Target (working hours)', required: true, initial: String(r.target_minutes / 60) }] });
                      if (x) await dialog.run(async () => { const { error } = await supabase.from('sla_rules').update({ target_minutes: Math.round(Number(x.h) * 60), updated_by: me.id }).eq('stage', r.stage); if (error) throw new Error(error.message); await reload(); }, 'Saved');
                    }}
                  />
                ) : null}
              </Row>
            }
          />
        ))}
      </Card>
      <Muted>A manager-set due date always overrides the default; the default is used to warn when a set date is unrealistic.</Muted>
    </Section>
  );
}

function Settings() {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const { data: rows } = await supabase.from('settings').select('*').order('key');
    return (rows ?? []) as { key: string; value: unknown; description: string | null }[];
  });
  return (
    <Section title="Settings" right={['sys_admin', 'gm'].includes(me.role) ? <Button small title="+ Report logo URL" onPress={async () => {
      const r = await dialog.prompt({ title: 'Report logo', message: 'Public or signed URL of the DIMO logo (PNG / SVG) used on every PDF report.', fields: [{ key: 'u', label: 'Logo URL', required: true }] });
      if (r) await dialog.run(async () => { const { error } = await supabase.from('settings').upsert({ key: 'report_logo_url', value: r.u, description: 'Logo on branded PDF reports' }); if (error) throw new Error(error.message); await reload(); }, 'Saved');
    }} /> : undefined}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((s) => (
          <ListRow
            key={s.key}
            title={s.description ?? s.key}
            subtitle={`${s.key} = ${JSON.stringify(s.value)}`}
            right={
              ['sys_admin', 'gm'].includes(me.role) ? (
                <Button
                  small
                  variant="ghost"
                  title="Edit"
                  onPress={async () => {
                    const r = await dialog.prompt({ title: s.key, message: 'JSON value, e.g. 500 or "13:00" (with quotes)', fields: [{ key: 'v', label: 'Value', required: true, initial: JSON.stringify(s.value) }] });
                    if (!r) return;
                    await dialog.run(async () => {
                      const { error } = await supabase.from('settings').update({ value: JSON.parse(r.v), updated_by: me.id, updated_at: new Date().toISOString() }).eq('key', s.key);
                      if (error) throw new Error(error.message);
                      await reload();
                    }, 'Saved');
                  }}
                />
              ) : undefined
            }
          />
        ))}
      </Card>
    </Section>
  );
}

function Calendar() {
  const me = useMe();
  const dialog = useDialog();
  const admin = me.role === 'sys_admin';
  const { data, reload } = useLoad(async () => {
    const [h, r] = await Promise.all([supabase.from('holidays').select('*').order('day'), supabase.from('exchange_rates').select('*').order('month', { ascending: false })]);
    return { holidays: (h.data ?? []) as { day: string; name: string }[], rates: (r.data ?? []) as { month: string; usd_to_lkr: number }[] };
  });
  return (
    <>
      <Section title="Public and mercantile holidays (excluded from SLA clocks)" right={admin ? <Button small title="+ Holiday" onPress={async () => {
        const r = await dialog.prompt({ title: 'Holiday', fields: [{ key: 'd', label: 'Date', type: 'date', required: true }, { key: 'n', label: 'Name', required: true }] });
        if (r) await dialog.run(async () => { const { error } = await supabase.from('holidays').upsert({ day: r.d, name: r.n }); if (error) throw new Error(error.message); await reload(); }, 'Saved');
      }} /> : undefined}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(data?.holidays ?? []).map((h) => (
            <ListRow key={h.day} title={h.name} subtitle={fmtDate(h.day)} right={admin ? <Button small variant="ghost" title="Remove" onPress={() => dialog.run(async () => { await supabase.from('holidays').delete().eq('day', h.day); await reload(); })} /> : undefined} />
          ))}
          {!data?.holidays.length ? <Notice tone={colors.amber}>No holidays entered – add this year&apos;s Sri Lanka public, bank and mercantile holidays (including Poya days).</Notice> : null}
        </Card>
      </Section>
      <Section title="Monthly exchange rate (USD → LKR, used for consolidated totals)" right={admin ? <Button small title="+ Rate" onPress={async () => {
        const r = await dialog.prompt({ title: 'Exchange rate', fields: [{ key: 'm', label: 'Month (first day, YYYY-MM-01)', type: 'date', required: true }, { key: 'r', label: '1 USD = LKR', required: true }] });
        if (r) await dialog.run(async () => { const { error } = await supabase.from('exchange_rates').upsert({ month: `${r.m.slice(0, 7)}-01`, usd_to_lkr: Number(r.r), updated_by: me.id }); if (error) throw new Error(error.message); await reload(); }, 'Saved');
      }} /> : undefined}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(data?.rates ?? []).map((r) => (
            <ListRow key={r.month} title={r.month.slice(0, 7)} right={<Pill label={`1 USD = ${r.usd_to_lkr} LKR`} />} />
          ))}
          {!data?.rates.length ? <Notice tone={colors.amber}>No exchange rate set – consolidated LKR totals fall back to 300.</Notice> : null}
        </Card>
      </Section>
    </>
  );
}

function Brands() {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const { data: rows } = await supabase.from('brands').select('*').order('name');
    return (rows ?? []) as { id: number; name: string; manufacturer: string | null; country: string | null; origin: string; level: string; active: boolean; status: string }[];
  });
  return (
    <Section title="Brand master list" right={me.role === 'sys_admin' ? <Button small title="+ Brand" onPress={async () => {
      const r = await dialog.prompt({
        title: 'Brand',
        fields: [
          { key: 'name', label: 'Brand', required: true },
          { key: 'manufacturer', label: 'Manufacturer' },
          { key: 'country', label: 'Country of origin' },
          { key: 'origin', label: 'Origin group', type: 'select', required: true, options: [{ value: 'european', label: 'European' }, { value: 'chinese', label: 'Chinese' }, { value: 'other', label: 'Other' }] },
          { key: 'level', label: 'Level', type: 'select', required: true, options: [{ value: 'high', label: 'High end' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low end' }] },
        ],
      });
      if (r) await dialog.run(async () => { const { error } = await supabase.from('brands').insert({ ...r, manufacturer: r.manufacturer || null, country: r.country || null }); if (error) throw new Error(error.message); await reload(); }, 'Added');
    }} /> : undefined}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((b) => (
          <ListRow key={b.id} title={b.name} subtitle={[b.manufacturer, b.country].filter(Boolean).join(' · ')} right={<Row gap={4}><Pill label={b.origin} /><Pill label={b.level} tone={colors.blue} />{b.status !== 'approved' ? <Pill label={b.status} tone={b.status === 'pending' ? colors.amber : colors.red} /> : null}</Row>} />
        ))}
      </Card>
    </Section>
  );
}

function Competitors() {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const { data: rows } = await supabase.from('competitors').select('*').order('name');
    return (rows ?? []) as { id: number; name: string; active: boolean }[];
  });
  return (
    <Section title="Competitor list (new names added by SM Projects)" right={['sm_projects', 'sys_admin'].includes(me.role) ? <Button small title="+ Competitor" onPress={async () => {
      const r = await dialog.prompt({ title: 'Competitor', fields: [{ key: 'n', label: 'Name', required: true }] });
      if (r) await dialog.run(async () => { const { error } = await supabase.from('competitors').insert({ name: r.n, created_by: me.id }); if (error) throw new Error(error.message); await reload(); }, 'Added');
    }} /> : undefined}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((c) => (
          <ListRow key={c.id} title={c.name} />
        ))}
      </Card>
    </Section>
  );
}
