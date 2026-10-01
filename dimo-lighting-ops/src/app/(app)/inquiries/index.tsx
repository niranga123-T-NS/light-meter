import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { InquiryCard } from '@/components/InquiryBits';
import { Button, colors, Empty, ErrorBanner, Row, Screen, Segmented, Select, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales, PROJECT_TYPES } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Inquiry } from '@/lib/types';

type Tab = 'all' | 'design' | 'estimation' | 'delayed' | 'follow_up' | 'drafts' | 'closed';

const DESIGN = ['submitted', 'accepted', 'in_design', 'design_review', 'design_approved'];
const EST = ['in_estimation', 'estimation_review'];
const FOLLOW = ['quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval', 'client_approved'];
const CLOSED = ['won', 'lost', 'cancelled', 'rejected'];

/** "My Pending Designs & Estimations" for sales (5.4) and the inquiry list for every other role. */
export default function Inquiries() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const sales = isSales(me.role);
  // Sales, SM Projects and GM / DGM can raise inquiries, so they also see drafts and returned ones
  const raises = sales || me.role === 'sm_projects' || me.role === 'gm';
  const [tab, setTab] = useState<Tab>(params.tab ?? (sales || me.role === 'sm_projects' ? 'design' : 'all'));
  const [sort, setSort] = useState<'due' | 'deadline' | 'value'>('due');
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('inquiries').select('*').order('customer_deadline').limit(1000);
    if (e) throw new Error(e.message);
    return rows as Inquiry[];
  });

  const all = data ?? [];
  const isDesign = (i: Inquiry) => DESIGN.includes(i.status) && i.route !== 'B';
  const isEst = (i: Inquiry) => EST.includes(i.status) || (i.route === 'B' && ['submitted', 'accepted'].includes(i.status));
  const filters: Record<Tab, (i: Inquiry) => boolean> = {
    all: (i) => !CLOSED.includes(i.status) && i.status !== 'draft',
    design: isDesign,
    estimation: isEst,
    delayed: (i) => i.sla_colour === 'red' && !CLOSED.includes(i.status),
    follow_up: (i) => FOLLOW.includes(i.status),
    drafts: (i) => ['draft', 'returned_for_info'].includes(i.status),
    closed: (i) => CLOSED.includes(i.status),
  };
  const s = q.trim().toLowerCase();
  const rows = all
    .filter(filters[tab])
    .filter((i) => !type || i.project_type === type)
    .filter((i) => !s || [i.code, i.project_name, i.customer_name].some((v) => v?.toLowerCase().includes(s)))
    .sort((a, b) => {
      // Delayed items are pinned to the top in red (5.4)
      const red = Number(b.sla_colour === 'red') - Number(a.sla_colour === 'red');
      if (red) return red;
      if (sort === 'deadline') return (a.customer_deadline ?? '9').localeCompare(b.customer_deadline ?? '9');
      if (sort === 'value') return Number(b.budget_lkr ?? 0) - Number(a.budget_lkr ?? 0);
      return (a.revised_due_at ?? a.current_due_at ?? '9').localeCompare(b.revised_due_at ?? b.current_due_at ?? '9');
    });
  const badge = (t: Tab) => all.filter(filters[t]).filter((i) => i.sla_colour === 'red').length;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: sales ? 'My Pending Designs & Estimations' : 'Inquiries' }} />
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Pending designs', badge: badge('design') },
            { value: 'estimation', label: 'Pending estimations', badge: badge('estimation') },
            { value: 'all', label: 'All open' },
            { value: 'delayed', label: 'Delayed', badge: badge('delayed') },
            { value: 'follow_up', label: 'Ready / with client' },
            ...(raises ? [{ value: 'drafts' as const, label: 'Drafts / returned', badge: all.filter(filters.drafts).length }] : []),
            { value: 'closed', label: 'Closed' },
          ]}
        />
        {raises ? <Button title="+ New inquiry" onPress={() => router.push('/inquiries/new')} /> : null}
      </Row>
      <Row wrap gap={8} style={{ marginTop: 8 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search code, project or customer" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1, minWidth: 220 }]} />
        <View style={{ width: 180 }}>
          <Select label="Project type" value={type} options={[{ value: '', label: 'All types' }, ...PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))]} onChange={(v) => setType(v || null)} />
        </View>
        <View style={{ width: 180 }}>
          <Select
            label="Sort by"
            value={sort}
            onChange={(v) => setSort(v as 'due')}
            options={[
              { value: 'due', label: 'Internal due date' },
              { value: 'deadline', label: 'Customer deadline' },
              { value: 'value', label: 'Budget value' },
            ]}
          />
        </View>
      </Row>
      <ErrorBanner message={error} />
      <View style={{ gap: 8 }}>
        {rows.map((i) => (
          <InquiryCard key={i.id} inquiry={i} ownerName={people[i.current_owner_id ?? '']?.full_name} />
        ))}
        {data && !rows.length ? <Empty title="Nothing here" /> : null}
      </View>
    </Screen>
  );
}
