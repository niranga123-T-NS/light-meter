import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Row, Screen, styles } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';

export default function Customers() {
  const people = usePeople();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('organizations').select('*').is('merged_into', null).order('name').limit(2000);
    if (e) throw new Error(e.message);
    return rows as Organization[];
  });
  const s = q.trim().toLowerCase();
  const rows = (data ?? []).filter((o) => !s || [o.name, o.phone, o.email, o.visit_category].some((v) => v?.toLowerCase().includes(s)));
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Customers' }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search customers" placeholderTextColor={colors.faint} style={[styles.input, { flex: 1 }]} />
        <Button title="+ New" onPress={() => router.push('/customers/new')} />
      </Row>
      <ErrorBanner message={error} />
      <Muted style={{ marginVertical: 8 }}>{rows.length} organizations</Muted>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.slice(0, 300).map((o) => (
          <ListRow
            key={o.id}
            title={o.name}
            subtitle={`${o.visit_category} · owner ${people[o.account_owner_id ?? '']?.full_name ?? '—'}${o.phone ? ` · ${o.phone}` : ''}`}
            onPress={() => router.push(`/customers/${o.id}`)}
          />
        ))}
        {data && !rows.length ? <Empty title="No customers found" /> : null}
      </Card>
    </Screen>
  );
}
