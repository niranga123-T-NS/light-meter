// Design & estimation work queue. Designers see design work, estimators see
// estimation work, salespeople follow the requests they raised, managers see all.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Badge, Button, Chip, colors, EmptyState, ListItem, Muted, Row, space } from '@/components/ui';
import { cacheStore, profileName, upsertCached, useCache } from '@/lib/cache';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase, unwrap } from '@/lib/supabase';
import type { WorkRequest } from '@/lib/types';
import { useAsync, useRefreshOnFocus } from '@/lib/useAsync';
import { isOpen, kindLabel, workState } from '@/lib/work';

type Scope = 'mine' | 'queue' | 'open' | 'late' | 'done';

export default function Work() {
  const { profile, isManager, isTeam, teamKind } = useSession();
  const cached = useCache('workRequests');
  const [scope, setScope] = useState<Scope>(isTeam ? 'mine' : isManager ? 'open' : 'mine');
  const [kind, setKind] = useState<'all' | 'design' | 'estimation'>(teamKind ?? 'all');

  const { data, reload, loading } = useAsync(async () => {
    const rows = unwrap(await supabase.from('work_requests').select('*')
      .or(`status.in.(new,in_progress,on_hold),completed_at.gte.${new Date(Date.now() - 60 * 86400000).toISOString()}`)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(2000)) as WorkRequest[];
    rows.forEach((r) => upsertCached('workRequests', r));
    return rows;
  }, []);
  useRefreshOnFocus(reload);
  const all = data ?? cached;

  const list = useMemo(() => all.filter((w) => {
    if (kind !== 'all' && w.kind !== kind) return false;
    switch (scope) {
      case 'mine': return isTeam ? w.assigned_to === profile?.id && isOpen(w) : w.requested_by === profile?.id && w.status !== 'cancelled';
      case 'queue': return isOpen(w) && !w.assigned_to;
      case 'open': return isOpen(w);
      case 'late': return workState(w).late;
      case 'done': return w.status === 'submitted';
    }
    return true;
  }).sort((a, b) => Number(workState(b).late) - Number(workState(a).late) || (a.due_date ?? '').localeCompare(b.due_date ?? '')),
  [all, kind, scope, isTeam, profile?.id]);

  const lateCount = all.filter((w) => (kind === 'all' || w.kind === kind) && workState(w).late).length;
  const pkg = (id: string) => cacheStore.get().opportunities.find((o) => o.id === id);
  const proj = (id?: string | null) => cacheStore.get().projects.find((p) => p.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.md, gap: space.sm, backgroundColor: '#fff' }}>
        {!isTeam ? (
          <Row wrap>
            <Chip label="All" selected={kind === 'all'} onPress={() => setKind('all')} />
            <Chip label="Design" selected={kind === 'design'} onPress={() => setKind('design')} />
            <Chip label="Estimation" selected={kind === 'estimation'} onPress={() => setKind('estimation')} />
          </Row>
        ) : null}
        <Row wrap>
          <Chip label={isTeam ? 'My work' : 'My requests'} selected={scope === 'mine'} onPress={() => setScope('mine')} />
          {isTeam || isManager ? <Chip label="Unassigned" selected={scope === 'queue'} onPress={() => setScope('queue')} /> : null}
          <Chip label="All open" selected={scope === 'open'} onPress={() => setScope('open')} />
          <Chip label={`Late${lateCount ? ` (${lateCount})` : ''}`} selected={scope === 'late'} onPress={() => setScope('late')} />
          <Chip label="Submitted" selected={scope === 'done'} onPress={() => setScope('done')} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>{list.length} request{list.length === 1 ? '' : 's'}{loading ? ' · updating…' : ''}</Muted>
          <Button small title="＋ New request" onPress={() => router.push({ pathname: '/work/new', params: teamKind ? { kind: teamKind } : {} })} />
        </Row>
      </View>
      <FlatList
        data={list}
        keyExtractor={(w) => w.id}
        onRefresh={reload}
        refreshing={false}
        ListEmptyComponent={<EmptyState title="Nothing here" message={scope === 'mine' && isTeam ? 'Check the Unassigned queue for new requests.' : undefined} />}
        renderItem={({ item: w }) => {
          const st = workState(w);
          return (
            <ListItem
              title={`${kindLabel(w.kind)}${w.revision ? ` · Rev ${w.revision}` : ''}: ${w.title}`}
              subtitle={[proj(w.project_id)?.name, pkg(w.opportunity_id)?.name].filter(Boolean).join(' › ')}
              meta={`${w.code ?? ''} · ${w.assigned_to ? profileName(w.assigned_to) : 'Unassigned'} · ${w.status === 'submitted' ? `submitted ${fmtDate(w.completed_at)}` : `due ${fmtDate(w.due_date)}`}`}
              right={<Badge label={st.label} tone={st.tone} />}
              onPress={() => router.push(`/work/${w.id}`)}
            />
          );
        }}
      />
    </View>
  );
}
