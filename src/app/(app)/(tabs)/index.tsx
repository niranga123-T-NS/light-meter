// Daily agenda: planned visits, follow-ups due, drafts and sync state.
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { SyncBar, SyncStatusBadge } from '@/components/SyncBar';
import { Badge, Button, Card, EmptyState, ListItem, Muted, Row, Screen, SectionTitle, Title } from '@/components/ui';
import { customerName, lookupLabel, useCache } from '@/lib/cache';
import { addDaysIso, fmtDateTime, relativeDue, todayIso } from '@/lib/format';
import { sortedItems, useOutbox } from '@/lib/outbox';
import { isOpen, kindLabel, workState } from '@/lib/work';
import { useSession } from '@/lib/session';

export default function Today() {
  const { profile, sync, canSell, isTeam } = useSession();
  const work = useCache('workRequests');
  const [refreshing, setRefreshing] = useState(false);
  const actions = useCache('myActions');
  const planned = useCache('plannedVisits');
  const items = useOutbox((s) => s.items);
  useCache('customers'); // re-render when names change

  const today = todayIso();
  const weekEnd = addDaysIso(today, 7);
  const mine = actions.filter((a) => a.owner_id === profile?.id);
  const overdue = mine.filter((a) => a.due_date && a.due_date < today);
  const dueSoon = mine.filter((a) => a.due_date && a.due_date >= today && a.due_date <= weekEnd);
  const upcoming = planned
    .filter((v) => v.status === 'planned' && !items[v.id])
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
  const local = sortedItems(items).filter((i) => i.status !== 'synced');
  const recent = sortedItems(items).filter((i) => i.status === 'synced').slice(0, 5);

  const myWork = work.filter((w) => w.requested_by === profile?.id && (isOpen(w) || (w.completed_at ?? '').slice(0, 10) >= addDaysIso(today, -7)))
    .sort((a, b) => Number(workState(b).late) - Number(workState(a).late));

  const refresh = async () => {
    setRefreshing(true);
    await sync({ includeFailed: false });
    setRefreshing(false);
  };

  if (isTeam) return <Redirect href="/work" />;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <SyncBar />
      <Title>Hello{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</Title>
      {canSell ? (
        <Row>
          <Button title="Start a visit" icon="＋" style={{ flex: 1 }} onPress={() => router.push('/visit/new')} />
          <Button title="Plan" variant="secondary" onPress={() => router.push('/visit/plan')} />
        </Row>
      ) : null}

      {local.length > 0 ? (
        <>
          <SectionTitle>On this device</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {local.map((i) => (
              <ListItem
                key={i.id}
                title={customerName(i.payload.visit.customer_id) !== '–' ? customerName(i.payload.visit.customer_id)
                  : i.payload.new_customers[0]?.legal_name ?? 'New visit'}
                subtitle={i.error ?? lookupLabel('visit_type', i.payload.visit.visit_type)}
                meta={`Updated ${fmtDateTime(i.updatedAt)}`}
                right={<SyncStatusBadge status={i.status} />}
                onPress={() => router.push(`/visit/${i.id}`)}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Scheduled visits</SectionTitle>
      {upcoming.length === 0 ? <Muted>No planned visits.</Muted> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {upcoming.slice(0, 15).map((v) => (
            <ListItem
              key={v.id}
              title={customerName(v.customer_id)}
              subtitle={[lookupLabel('visit_type', v.visit_type), v.purpose].filter((x) => x && x !== '–').join(' · ')}
              meta={fmtDateTime(v.scheduled_at)}
              right={v.scheduled_at && v.scheduled_at.slice(0, 10) < today ? <Badge label="Missed" tone="danger" /> : undefined}
              onPress={() => router.push(`/visit/${v.id}`)}
            />
          ))}
        </Card>
      )}

      <SectionTitle right={<Button small variant="ghost" title="All actions" onPress={() => router.push('/actions')} />}>
        Follow-ups
      </SectionTitle>
      {overdue.length + dueSoon.length === 0 ? (
        <EmptyState title="You're up to date" message="No overdue or upcoming follow-ups this week." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {[...overdue, ...dueSoon].map((a) => {
            const due = relativeDue(a.due_date);
            return (
              <ListItem
                key={a.id}
                title={a.description}
                subtitle={customerName(a.customer_id)}
                right={<Badge label={due.label} tone={due.overdue ? 'danger' : 'warning'} />}
                onPress={() => router.push(`/action/${a.id}`)}
              />
            );
          })}
        </Card>
      )}

      {myWork.length > 0 ? (
        <>
          <SectionTitle right={<Button small variant="ghost" title="All" onPress={() => router.push('/work')} />}>Design & estimation progress</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {myWork.slice(0, 8).map((w) => {
              const st = workState(w);
              return (
                <ListItem key={w.id} title={`${kindLabel(w.kind)}${w.revision ? ` · Rev ${w.revision}` : ''}: ${w.title}`}
                  subtitle={w.status === 'submitted' ? 'Submitted – ready to send to the client' : `Due ${w.due_date ?? '–'}`}
                  right={<Badge label={st.label} tone={st.tone} />} onPress={() => router.push(`/work/${w.id}`)} />
              );
            })}
          </Card>
        </>
      ) : null}

      {recent.length > 0 ? (
        <>
          <SectionTitle>Recently submitted</SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {recent.map((i) => (
              <ListItem
                key={i.id}
                title={customerName(i.payload.visit.customer_id) !== '–' ? customerName(i.payload.visit.customer_id) : i.payload.new_customers[0]?.legal_name ?? 'Visit'}
                subtitle={i.serverCode ?? undefined}
                meta={fmtDateTime(i.syncedAt ?? i.updatedAt)}
                right={<SyncStatusBadge status={i.status} />}
                onPress={() => router.push(`/visit/view/${i.id}`)}
              />
            ))}
          </Card>
        </>
      ) : null}
      <View style={{ height: 24 }} />
    </Screen>
  );
}
