// Audit log (managers and administrators): who changed what, and when.
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { FormModal } from '@/components/FormModal';
import { Badge, Banner, Body, Card, Chip, ListItem, Muted, Row, Screen } from '@/components/ui';
import { profileName } from '@/lib/cache';
import { fmtDateTime } from '@/lib/format';
import { supabase, unwrap } from '@/lib/supabase';
import { useAsync } from '@/lib/useAsync';

interface Entry {
  id: number; table_name: string; record_id: string | null; record_code: string | null; action: string; changed_by: string | null;
  changed_at: string; changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; note: string | null;
}

const TABLES = ['all', 'visits', 'customers', 'contacts', 'projects', 'opportunities', 'actions', 'quotations', 'profiles', 'export_log'];

export default function Audit() {
  const [table, setTable] = useState('all');
  const [open, setOpen] = useState<Entry | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('audit_log').select('*').order('changed_at', { ascending: false }).limit(300);
    if (table !== 'all') q = q.eq('table_name', table);
    return unwrap(await q) as Entry[];
  }, [table]);

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: 'Audit log' }} />
      <Row wrap>{TABLES.map((t) => <Chip key={t} label={t} selected={table === t} onPress={() => setTable(t)} />)}</Row>
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((e) => (
          <ListItem key={e.id} title={`${e.table_name} ${e.record_code ?? ''}`.trim()}
            subtitle={`${profileName(e.changed_by)} · ${fmtDateTime(e.changed_at)}`}
            meta={e.changed_fields?.join(', ') ?? e.note ?? undefined}
            right={<Badge label={e.action} tone={e.action === 'delete' ? 'danger' : e.action === 'export' ? 'info' : 'neutral'} />}
            onPress={() => setOpen(e)} />
        ))}
      </Card>
      <FormModal visible={!!open} title="Change detail" onClose={() => setOpen(null)} onSave={() => setOpen(null)} saveLabel="Close">
        {open ? (
          <>
            <Muted>{open.table_name} · {open.action} · {profileName(open.changed_by)} · {fmtDateTime(open.changed_at)}</Muted>
            {(open.changed_fields ?? Object.keys(open.new_data ?? open.old_data ?? {})).map((f) => (
              <View key={f} style={{ gap: 2 }}>
                <Body style={{ fontWeight: '600' }}>{f}</Body>
                {open.old_data ? <Muted>Before: {JSON.stringify(open.old_data[f])}</Muted> : null}
                {open.new_data ? <Muted>After: {JSON.stringify(open.new_data[f])}</Muted> : null}
              </View>
            ))}
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
