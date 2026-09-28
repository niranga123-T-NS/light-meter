import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Badge, Button, Chip, colors, EmptyState, ListItem, Muted, Row, space } from '@/components/ui';
import { customerName, profileName, useCache } from '@/lib/cache';
import { relativeDue, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase, unwrap } from '@/lib/supabase';
import type { Action } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

type Scope = 'mine' | 'overdue' | 'team' | 'escalated';

export default function Actions() {
  const { profile, isManager } = useSession();
  const mine = useCache('myActions');
  const [scope, setScope] = useState<Scope>('mine');
  const today = todayIso();

  // Team / escalated views are online queries for managers
  const team = useAsync(async () => {
    if (scope !== 'team' && scope !== 'escalated') return [] as Action[];
    let q = supabase.from('actions').select('*').in('status', ['open', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(500);
    if (scope === 'escalated') q = q.eq('escalated', true);
    return unwrap(await q) as Action[];
  }, [scope]);

  const list = useMemo(() => {
    if (scope === 'team' || scope === 'escalated') return team.data ?? [];
    const own = mine.filter((a) => a.owner_id === profile?.id || a.created_by === profile?.id);
    return scope === 'overdue' ? own.filter((a) => a.due_date && a.due_date < today) : own;
  }, [scope, mine, team.data, profile?.id, today]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.md, gap: space.sm, backgroundColor: '#fff' }}>
        <Row wrap>
          <Chip label="My open" selected={scope === 'mine'} onPress={() => setScope('mine')} />
          <Chip label="Overdue" selected={scope === 'overdue'} onPress={() => setScope('overdue')} />
          {isManager ? <Chip label="Team" selected={scope === 'team'} onPress={() => setScope('team')} /> : null}
          {isManager ? <Chip label="Escalated" selected={scope === 'escalated'} onPress={() => setScope('escalated')} /> : null}
          <View style={{ flex: 1 }} />
          <Button small title="＋ New" onPress={() => router.push('/action/edit')} />
        </Row>
        <Muted>{list.length} action{list.length === 1 ? '' : 's'}{team.loading && scope !== 'mine' && scope !== 'overdue' ? ' · loading…' : ''}</Muted>
      </View>
      <FlatList
        data={list}
        keyExtractor={(a) => a.id}
        onRefresh={team.reload}
        refreshing={false}
        ListEmptyComponent={<EmptyState title="Nothing here" message={team.error ?? undefined} />}
        renderItem={({ item: a }) => {
          const due = relativeDue(a.due_date);
          return (
            <ListItem
              title={a.description}
              subtitle={[customerName(a.customer_id), scope === 'team' || scope === 'escalated' ? profileName(a.owner_id) : null].filter((x) => x && x !== '–').join(' · ')}
              meta={`${a.code ?? ''} · ${a.priority}${a.escalated ? ' · escalated' : ''}`}
              right={<Badge label={due.label} tone={due.overdue ? 'danger' : due.soon ? 'warning' : 'neutral'} />}
              onPress={() => router.push(`/action/${a.id}`)}
            />
          );
        }}
      />
    </View>
  );
}
