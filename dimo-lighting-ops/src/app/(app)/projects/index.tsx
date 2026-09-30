import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales, projectTypeLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Project } from '@/lib/types';

type Tab = 'active' | 'dormant' | 'won' | 'lost' | 'all';

export default function Projects() {
  const me = useMe();
  const people = usePeople();
  const [tab, setTab] = useState<Tab>('active');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    let query = supabase.from('projects').select('*, organizations(name)').is('merged_into', null).order('last_activity_at', { ascending: false }).limit(500);
    if (tab === 'active') query = query.eq('status', 'active');
    if (tab === 'dormant') query = query.in('status', ['dormant', 'on_hold']);
    if (tab === 'won') query = query.in('status', ['won', 'completed']);
    if (tab === 'lost') query = query.in('status', ['lost', 'cancelled']);
    const { data: rows, error: e } = await query;
    if (e) throw new Error(e.message);
    return rows as Project[];
  }, [tab]);

  const s = q.trim().toLowerCase();
  const rows = (data ?? []).filter((p) => !s || [p.name, p.code, p.city, p.organizations?.name].some((v) => v?.toLowerCase().includes(s)));
  const canCreate = isSales(me.role) || me.role === 'sm_projects' || me.role === 'gm';
  const sum = (cur: 'USD' | 'LKR', weighted: boolean) =>
    rows.filter((p) => p.currency === cur).reduce((a, p) => a + Number(p.lighting_value ?? 0) * (weighted ? p.win_probability / 100 : 1), 0);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Projects' }} />
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'dormant', label: 'Dormant / on hold' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost / cancelled' },
            { value: 'all', label: 'All' },
          ]}
        />
        {canCreate ? <Button title="+ New project" onPress={() => router.push('/projects/new')} /> : null}
      </Row>
      <TextInput value={q} onChangeText={setQ} placeholder="Filter by name, customer, city or code" placeholderTextColor={colors.faint} style={[styles.input, { marginVertical: 8 }]} />
      <Muted>
        Lighting value: {fmtMoney(sum('LKR', false), 'LKR')} + {fmtMoney(sum('USD', false), 'USD')} · weighted {fmtMoney(sum('LKR', true), 'LKR')} +{' '}
        {fmtMoney(sum('USD', true), 'USD')}
      </Muted>
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        {rows.map((p) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={`${p.code} · ${p.organizations?.name ?? ''} · ${projectTypeLabel(p.project_type)} · ${p.stage}${isSales(me.role) ? '' : ` · ${people[p.owner_id]?.full_name ?? ''}`}`}
            highlight={p.status === 'dormant' ? colors.amber : undefined}
            right={
              <Row gap={4}>
                <Muted>{fmtMoney(p.lighting_value, p.currency)}</Muted>
                <Pill label={`${p.win_probability}%`} tone={colors.blue} />
                <Pill label={p.project_term} />
                {p.status !== 'active' ? <Pill label={p.status} tone={p.status === 'dormant' ? colors.amber : colors.grey} /> : null}
              </Row>
            }
            onPress={() => router.push(`/projects/${p.id}`)}
          />
        ))}
        {data && !rows.length ? <Empty title="No projects" /> : null}
      </Card>
    </Screen>
  );
}
