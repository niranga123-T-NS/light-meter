import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';

import { Badge, Button, Chip, colors, EmptyState, ListItem, Muted, Row, space } from '@/components/ui';
import { customerName, useCache } from '@/lib/cache';
import { daysBetween, fmtDate, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';

type Filter = 'all' | 'mine' | 'deadlines' | 'stale';

export default function Projects() {
  const { profile, canSell } = useSession();
  const projects = useCache('projects');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const today = todayIso();

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (t && !`${p.name} ${(p.aliases ?? []).join(' ')} ${p.code} ${p.district ?? ''}`.toLowerCase().includes(t)) return false;
      if (filter === 'mine') return p.owner_id === profile?.id;
      if (filter === 'deadlines') return [p.tender_closing_date, p.quotation_due_date].some((d) => d && d >= today && daysBetween(today, d) <= 30);
      if (filter === 'stale') return p.status === 'active' && !!p.last_activity_at && daysBetween(p.last_activity_at.slice(0, 10), today) > 30;
      return true;
    });
  }, [projects, q, filter, profile?.id, today]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space.md, gap: space.sm, backgroundColor: '#fff' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search projects…" placeholderTextColor={colors.faint}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 15 }} />
        <Row wrap>
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="Mine" selected={filter === 'mine'} onPress={() => setFilter('mine')} />
          <Chip label="Deadlines ≤ 30d" selected={filter === 'deadlines'} onPress={() => setFilter('deadlines')} />
          <Chip label="No activity 30d" selected={filter === 'stale'} onPress={() => setFilter('stale')} />
          {canSell ? <Button small title="＋ New" onPress={() => router.push('/project/edit')} /> : null}
        </Row>
        <Muted>{list.length} project{list.length === 1 ? '' : 's'}</Muted>
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<EmptyState title="No projects" />}
        renderItem={({ item: p }) => {
          const deadline = [p.tender_closing_date, p.quotation_due_date].filter((d): d is string => !!d && d >= today).sort()[0];
          return (
            <ListItem
              title={p.name}
              subtitle={[p.code, customerName(p.customer_id), p.district].filter((x) => x && x !== '–').join(' · ')}
              meta={deadline ? `Next deadline ${fmtDate(deadline)}` : p.last_activity_at ? `Last activity ${fmtDate(p.last_activity_at)}` : undefined}
              right={p.status !== 'active' ? <Badge label={p.status ?? ''} /> : deadline && daysBetween(today, deadline) <= 7 ? <Badge label="Due soon" tone="warning" /> : undefined}
              onPress={() => router.push(`/project/${p.id}`)}
            />
          );
        }}
      />
    </View>
  );
}
