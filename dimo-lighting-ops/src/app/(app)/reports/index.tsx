import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { Card, colors, Empty, ListRow, Muted, Pill, Screen, Section, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MEETING_ACTION_REPORT_ROLES } from '@/lib/meetingActions';
import { isDesigner, isEstimator, reportsFor } from '@/lib/roles';
import type { Role } from '@/lib/types';

/** The node reports a role may open: sales for Sales, estimation for Estimation, design for Design, orders for Operations and management */
function nodeReports(r: Role) {
  const out: { title: string; sub: string; href: string }[] = [];
  if (['asm_building', 'asm_infra', 'sm_projects', 'gm'].includes(r)) out.push({ title: 'Sales – inquiry to the client’s decision', sub: 'Sales, intake, design, estimation, approvals, client (hidden), on hold', href: '/reports/nodes/sales' });
  if (r === 'sm_estimation' || isEstimator(r) || r === 'gm') out.push({ title: 'Estimation – job to released quotation', sub: 'Queue, estimator, suppliers and Sales / client (hidden), review, approvals, rework', href: '/reports/nodes/estimation' });
  if (r === 'design_manager' || isDesigner(r) || r === 'gm') out.push({ title: 'Design – job to released design', sub: 'Acknowledge, designer, Sales / client (hidden), date change, review, rework', href: '/reports/nodes/design' });
  if (['operations_exec', 'sm_estimation', 'sm_projects', 'gm'].includes(r)) out.push({ title: 'Import and local orders', sub: 'Lighting Dept, Director, FBP, Procurement, Finance (hidden), Logistics, outside DIMO', href: '/orders/nodes' });
  return out;
}

/** Reports tab (Section 9.7): only the reports the role may run are listed – others are hidden, not greyed out. */
export default function Reports() {
  const me = useMe();
  const [q, setQ] = useState('');
  const list = reportsFor(me.role).filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  const areas = Array.from(new Set(list.map((r) => r.area)));
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reports' }} />
      {me.role === 'gm' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow
            title="Management report – whole business"
            subtitle="P&L, invoicing, sales, cash, execution and warranty for a month, with highlights and exceptions"
            right={<Pill label="DGM" tone={colors.brand} />}
            onPress={() => router.push('/reports/management')}
          />
        </Card>
      ) : null}
      {MEETING_ACTION_REPORT_ROLES.includes(me.role) ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow
            title="Meeting actions"
            subtitle="Per person: done, not done and why, delayed, blocked and overdue actions from the meetings"
            right={<Pill label="Meetings" tone={colors.blue} />}
            onPress={() => router.push('/reports/meeting-actions')}
          />
        </Card>
      ) : null}
      {me.role === 'gm' || me.role === 'sm_projects' || me.role === 'sm_estimation' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ListRow
            title="Win Predictor use"
            subtitle="How each sales person uses the Win Probability Wizard – on what, how many times, and visits followed by an update"
            right={<Pill label="Sales" tone={colors.blue} />}
            onPress={() => router.push('/reports/win-usage')}
          />
        </Card>
      ) : null}
      {nodeReports(me.role).length ? (
        <Section title="Node reports – where the time goes">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {nodeReports(me.role).map((r) => (
              <ListRow key={r.href} title={r.title} subtitle={r.sub} onPress={() => router.push(r.href as never)} />
            ))}
          </Card>
        </Section>
      ) : null}
      <TextInput value={q} onChangeText={setQ} placeholder="Search reports" placeholderTextColor={colors.faint} style={styles.input} />
      {areas.map((a) => (
        <Section key={a} title={a}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {list
              .filter((r) => r.area === a)
              .map((r) => (
                <ListRow key={r.key} title={r.title} right={<Pill label={r.scope ?? ''} tone={colors.blue} />} onPress={() => router.push(`/reports/${r.key}`)} />
              ))}
          </Card>
        </Section>
      ))}
      {!list.length ? <Empty title="No reports for your role" /> : null}
      <Muted style={{ marginTop: 12 }}>Your role&apos;s scope is applied automatically and cannot be widened by filters. Every run and download is logged.</Muted>
    </Screen>
  );
}
