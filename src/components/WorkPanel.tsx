// Design & estimation progress for a package or project: every request and
// revision with its status, due date and lateness, the inquiry → quotation
// timeline, and buttons to request work or a revision.
import { router } from 'expo-router';
import { View } from 'react-native';

import { cacheStore, profileName } from '@/lib/cache';
import { daysBetween, fmtDate, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Quotation, WorkRequest } from '@/lib/types';
import { isOpen, kindLabel, turnaroundDays, workState } from '@/lib/work';

import { Badge, Body, Button, Card, ListItem, Muted, Row, SectionTitle } from './ui';

export function WorkPanel({ requests, opportunityId, projectLevel, inquiryDate, quotations }: {
  requests: WorkRequest[]; opportunityId?: string; projectLevel?: boolean; inquiryDate?: string | null; quotations?: Quotation[];
}) {
  const { canSell, isManager, teamKind } = useSession();
  const sorted = [...requests].sort((a, b) => (a.kind + a.revision).localeCompare(b.kind + b.revision) || (a.received_at ?? '').localeCompare(b.received_at ?? ''));
  const canRequest = !!opportunityId && (canSell || isManager);
  const latestSubmitted = (k: string) => [...requests].filter((w) => w.kind === k && w.status === 'submitted')
    .sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0];

  const firstQuote = (quotations ?? []).filter((q) => q.status !== 'draft' && q.submission_date).map((q) => q.submission_date!).sort()[0];
  const elapsed = inquiryDate ? daysBetween(inquiryDate, firstQuote ?? todayIso()) : null;
  const pkgName = (id: string) => cacheStore.get().opportunities.find((o) => o.id === id)?.name ?? '';

  return (
    <>
      <SectionTitle>Design & estimation</SectionTitle>
      {!projectLevel && inquiryDate ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>Inquiry received</Muted><Body>{fmtDate(inquiryDate)}</Body>
          </Row>
          {(['design', 'estimation'] as const).map((k) => {
            const list = requests.filter((w) => w.kind === k && w.status !== 'cancelled');
            if (!list.length) return null;
            const done = list.filter((w) => w.status === 'submitted').length;
            return (
              <Row key={k} style={{ justifyContent: 'space-between' }}>
                <Muted>{kindLabel(k)} ({list.length} incl. revisions)</Muted>
                <Body>{done}/{list.length} submitted</Body>
              </Row>
            );
          })}
          <Row style={{ justifyContent: 'space-between' }}>
            <Muted>First quotation submitted</Muted><Body>{firstQuote ? fmtDate(firstQuote) : 'Not yet'}</Body>
          </Row>
          {elapsed !== null ? (
            <Badge label={firstQuote ? `Inquiry → quotation: ${elapsed} days` : `${elapsed} days since inquiry`} tone={firstQuote ? 'success' : 'info'} />
          ) : null}
        </Card>
      ) : null}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {sorted.length === 0 ? <Muted style={{ padding: 16 }}>No design or estimation requests yet.</Muted> : sorted.map((w) => {
          const st = workState(w);
          const t = turnaroundDays(w);
          return (
            <ListItem key={w.id}
              title={`${kindLabel(w.kind)}${w.revision ? ` · Rev ${w.revision}` : ''}: ${w.title}`}
              subtitle={[projectLevel ? pkgName(w.opportunity_id) : null, w.assigned_to ? profileName(w.assigned_to) : 'Unassigned',
                w.status === 'submitted' ? `submitted ${fmtDate(w.completed_at)}` : `due ${fmtDate(w.due_date)}`].filter(Boolean).join(' · ')}
              meta={`${w.code ?? ''}${t !== null ? ` · ${t} days${w.status === 'submitted' ? ' turnaround' : ' so far'}` : ''}`}
              right={<Badge label={st.label} tone={st.tone} />}
              onPress={() => router.push(`/work/${w.id}`)} />
          );
        })}
      </Card>
      {canRequest || teamKind ? (
        <View style={{ gap: 8 }}>
          <Row wrap>
            {(canRequest || teamKind === 'design') ? (
              <Button small variant="secondary" title="＋ Design request"
                onPress={() => router.push({ pathname: '/work/new', params: { opportunityId: opportunityId!, kind: 'design' } })} />
            ) : null}
            {(canRequest || teamKind === 'estimation') ? (
              <Button small variant="secondary" title="＋ Estimation request"
                onPress={() => router.push({ pathname: '/work/new', params: { opportunityId: opportunityId!, kind: 'estimation' } })} />
            ) : null}
          </Row>
          {canRequest ? (
            <Row wrap>
              {latestSubmitted('design') ? (
                <Button small variant="ghost" title="↻ Request design revision"
                  onPress={() => router.push({ pathname: '/work/new', params: { opportunityId: opportunityId!, parentId: latestSubmitted('design')!.id } })} />
              ) : null}
              {latestSubmitted('estimation') ? (
                <Button small variant="ghost" title="↻ Request estimation revision"
                  onPress={() => router.push({ pathname: '/work/new', params: { opportunityId: opportunityId!, parentId: latestSubmitted('estimation')!.id } })} />
              ) : null}
            </Row>
          ) : null}
          {requests.some((w) => isOpen(w) && workState(w).late) ? <Muted>Late items are alerted daily to the team and managers.</Muted> : null}
        </View>
      ) : null}
    </>
  );
}
