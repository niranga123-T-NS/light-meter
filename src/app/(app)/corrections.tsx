import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, EmptyState, Muted, Row, Screen } from '@/components/ui';
import { profileName } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import { useAsync } from '@/lib/useAsync';

interface Correction {
  id: string; visit_id: string; requested_by: string; requested_at: string; reason: string; changes: Record<string, unknown>;
  status: string; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; visit: { code: string } | null;
}

export default function Corrections() {
  const { isManager } = useSession();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, error, loading, reload } = useAsync(async () => unwrap(await supabase.from('correction_requests')
    .select('*, visit:visits(code)').order('status').order('requested_at', { ascending: false }).limit(200)) as Correction[], []);

  const decide = async (c: Correction, approve: boolean) => {
    const { error: err } = await supabase.rpc(approve ? 'approve_correction' : 'reject_correction', { p_id: c.id, p_note: notes[c.id] ?? null });
    if (err) return notify('Not saved', errorMessage(err));
    void reload();
  };

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: 'Visit corrections' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      {(data ?? []).length === 0 ? <EmptyState title="No correction requests" /> : data!.map((c) => (
        <Card key={c.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: '700' }} >{c.visit?.code ?? 'Visit'}</Body>
            <Badge label={c.status} tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'} />
          </Row>
          <Muted>{profileName(c.requested_by)} · {fmtDateTime(c.requested_at)}</Muted>
          <Body>Reason: {c.reason}</Body>
          {Object.entries(c.changes).map(([k, v]) => (
            <View key={k}><Muted>{k.replace(/_/g, ' ')}:</Muted><Body>{String(v)}</Body></View>
          ))}
          {c.reviewed_by ? <Muted>Reviewed by {profileName(c.reviewed_by)} {fmtDateTime(c.reviewed_at)}{c.review_note ? ` – ${c.review_note}` : ''}</Muted> : null}
          <Button small variant="ghost" title="Open visit" onPress={() => router.push(`/visit/view/${c.visit_id}`)} />
          {isManager && c.status === 'pending' ? (
            <>
              <TextField label="Note (optional)" value={notes[c.id] ?? ''} onChange={(t) => setNotes({ ...notes, [c.id]: t })} />
              <Row>
                <Button style={{ flex: 1 }} title="Approve" onPress={() => decide(c, true)} />
                <Button style={{ flex: 1 }} variant="danger" title="Reject" onPress={() => decide(c, false)} />
              </Row>
            </>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
