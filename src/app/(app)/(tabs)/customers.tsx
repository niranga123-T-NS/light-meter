import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';

import { Badge, Button, Chip, colors, EmptyState, ListItem, Muted, Row, space } from '@/components/ui';
import { lookupLabel, useCache } from '@/lib/cache';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function Customers() {
  const { profile, canSell } = useSession();
  const customers = useCache('customers');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers.filter((c) => (!mine || c.owner_id === profile?.id)
      && (!t || `${c.legal_name} ${c.trading_name ?? ''} ${c.code} ${c.city ?? ''}`.toLowerCase().includes(t)));
  }, [customers, q, mine, profile?.id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.md, gap: space.sm, backgroundColor: '#fff' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search customers…" placeholderTextColor={colors.faint}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 15 }} />
        <Row>
          <Chip label="All" selected={!mine} onPress={() => setMine(false)} />
          <Chip label="My accounts" selected={mine} onPress={() => setMine(true)} />
          <View style={{ flex: 1 }} />
          {canSell ? <Button small title="＋ New" onPress={() => router.push('/customer/edit')} /> : null}
        </Row>
        <Muted>{list.length} customer{list.length === 1 ? '' : 's'}</Muted>
      </View>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<EmptyState title="No customers" message="Pull down on Today to refresh, or create one." />}
        renderItem={({ item: c }) => (
          <ListItem
            title={c.trading_name || c.legal_name}
            subtitle={[c.code, lookupLabel('customer_category', c.category), c.city].filter((x) => x && x !== '–').join(' · ')}
            meta={c.last_visit_at ? `Last visit ${fmtDate(c.last_visit_at)}` : 'Not visited yet'}
            right={c.status === 'provisional' ? <Badge label="Provisional" tone="warning" /> : c.strategic_priority === 'A' ? <Badge label="A" tone="primary" /> : undefined}
            onPress={() => router.push(`/customer/${c.id}`)}
          />
        )}
      />
    </View>
  );
}
