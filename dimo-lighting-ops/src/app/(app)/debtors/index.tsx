import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AgeingChip } from '@/components/Ageing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { AGEING_COLOURS, AGEING_ORDER, fmtDate, fmtMoney, human } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Debt } from '@/lib/types';

type Filter = 'open' | 'legal' | 'mismatch' | 'non_moving' | 'closed';

/** My Debtors (sales) / All Debtors (SM Projects, GM, Operations) – Section 12.4. */
export default function Debtors() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ bucket?: string; filter?: Filter }>();
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'open');
  const [bucket, setBucket] = useState<string | null>(params.bucket ?? null);
  const [sort, setSort] = useState<'days' | 'amount' | 'client'>('days');
  const [person, setPerson] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('debts').select('*').order('outstanding_days', { ascending: false }).limit(3000);
    if (e) throw new Error(e.message);
    return rows as Debt[];
  });

  const [fourteen] = useState(() => Date.now() - 14 * 86400000);
  const all = data ?? [];
  const open = all.filter((d) => !['collected_confirmed', 'cleared'].includes(d.status));
  const byFilter: Record<Filter, Debt[]> = {
    open,
    legal: open.filter((d) => d.is_legal),
    mismatch: open.filter((d) => d.collection_mismatch),
    non_moving: open.filter((d) => !d.is_legal && !['collected', 'disputed'].includes(d.status) && Date.parse(d.last_status_at) < fourteen && Date.parse(d.last_amount_change_at) < fourteen),
    closed: all.filter((d) => ['collected_confirmed', 'cleared'].includes(d.status)),
  };
  const rows = byFilter[filter]
    .filter((d) => !bucket || d.ageing_bucket === bucket)
    .filter((d) => !person || d.sales_person_id === person)
    .sort((a, b) => (sort === 'amount' ? b.amount - a.amount : sort === 'client' ? (a.client_name ?? '').localeCompare(b.client_name ?? '') : b.outstanding_days - a.outstanding_days));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: isSales(me.role) ? 'My Debtors' : 'Debtors' }} />
      <ErrorBanner message={error} />
      {/* Summary strip: total outstanding by category and currency */}
      <Card>
        <Row wrap gap={6}>
          {AGEING_ORDER.map((b) => {
            const list = open.filter((d) => d.ageing_bucket === b);
            const c = AGEING_COLOURS[b];
            return (
              <Pressable key={b} onPress={() => setBucket(bucket === b ? null : b)} style={{ minWidth: 118, padding: 8, borderRadius: 8, borderWidth: 2, borderColor: bucket === b ? colors.ink : colors.line }}>
                <AgeingChip bucket={b} />
                <Text style={{ fontWeight: '700', marginTop: 4 }}>{list.length}</Text>
                <Muted>{fmtMoney(list.filter((d) => d.currency === 'LKR').reduce((a, d) => a + Number(d.amount), 0), 'LKR')}</Muted>
                <Muted>{fmtMoney(list.filter((d) => d.currency === 'USD').reduce((a, d) => a + Number(d.amount), 0), 'USD')}</Muted>
                <View style={{ height: 3, backgroundColor: c.bg, marginTop: 4 }} />
              </Pressable>
            );
          })}
        </Row>
      </Card>
      <Row wrap style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open', badge: 0 },
            { value: 'legal', label: 'Legal', badge: byFilter.legal.length },
            { value: 'non_moving', label: 'Non-moving', badge: byFilter.non_moving.length },
            { value: 'mismatch', label: 'Collection mismatch', badge: byFilter.mismatch.length },
            { value: 'closed', label: 'Collected / cleared' },
          ]}
        />
        {me.role === 'operations_exec' ? <Button title="⇪ Upload" onPress={() => router.push('/debtors/upload')} /> : null}
      </Row>
      <Row wrap gap={8}>
        <View style={{ width: 200 }}>
          <Select
            label="Sort"
            value={sort}
            onChange={(v) => setSort(v as 'days')}
            options={[
              { value: 'days', label: 'Outstanding days' },
              { value: 'amount', label: 'Amount' },
              { value: 'client', label: 'Client' },
            ]}
          />
        </View>
        {!isSales(me.role) ? (
          <View style={{ width: 220 }}>
            <Select
              label="Sales person"
              value={person}
              onChange={(v) => setPerson(v || null)}
              options={[{ value: '', label: 'All' }, ...Object.values(people).filter((p) => isSales(p.role)).map((p) => ({ value: p.id, label: p.full_name }))]}
            />
          </View>
        ) : null}
      </Row>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((d) => (
          <ListRow
            key={d.id}
            left={<AgeingChip bucket={d.ageing_bucket} legal={d.is_legal} />}
            title={`${d.client_name ?? ''} · ${d.invoice_no}`}
            subtitle={`${d.project_name ?? ''} · ${d.outstanding_days} days · ${human(d.status)}${d.status === 'payment_promised' ? ` ${fmtDate(d.promised_date)}` : ''}${isSales(me.role) ? '' : ` · ${people[d.sales_person_id ?? '']?.full_name ?? ''}`}${d.is_legal && d.next_hearing_date ? ` · hearing ${fmtDate(d.next_hearing_date)}` : ''}`}
            right={
              <Row gap={4}>
                {d.collection_mismatch ? <Pill label="Mismatch" tone={colors.red} /> : null}
                <Text style={{ fontWeight: '700' }}>{fmtMoney(d.amount, d.currency)}</Text>
              </Row>
            }
            onPress={() => router.push(`/debtors/${d.id}`)}
          />
        ))}
        {data && !rows.length ? <Empty title="No debts here" /> : null}
      </Card>
    </Screen>
  );
}
