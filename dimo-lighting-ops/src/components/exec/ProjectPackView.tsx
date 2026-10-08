import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Card, colors, Grid, Muted, Progress, Row, Section, Stat } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { projectFacts, type ProjectPack } from '@/lib/projectMeeting';

/** The project meeting pack on the meeting page: headline figures, then every fact and list (the same as in the minutes). */
export function ProjectPackView({ pack, general }: { pack: ProjectPack; general: ReactNode }) {
  const { facts, lists } = projectFacts(pack);
  const g = pack.progress;
  const gap = g.planned != null && g.actual != null ? g.actual - g.planned : null;
  return (
    <>
      <Section title={`${pack.project.no} · ${pack.project.name}`}>
        <Grid min={150}>
          <Stat label="Planned progress" value={g.planned != null ? `${g.planned}%` : '—'} />
          <Stat label="Actual progress" value={g.actual != null ? `${g.actual}%` : '—'} tone={gap != null ? (gap < -10 ? 'red' : gap < 0 ? 'amber' : 'green') : undefined} />
          <Stat label="Finish vs baseline" value={g.late_days != null ? (g.late_days > 0 ? `${g.late_days} d late` : 'On time') : '—'} tone={g.late_days ? (g.late_days > 0 ? 'red' : 'green') : undefined} />
          <Stat label="Activities behind" value={pack.behind.length} tone={pack.behind.length ? 'red' : undefined} />
          <Stat label="HSE open" value={pack.hse.open + pack.hse.actions_open} tone={pack.hse.open ? 'amber' : undefined} />
          <Stat label="Billing at risk" value={pack.billing.at_risk} tone={pack.billing.red ? 'red' : pack.billing.at_risk ? 'amber' : undefined} />
        </Grid>
        {g.live && g.actual != null ? (
          <Card style={{ marginTop: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text }}>Actual against planned</Text>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${g.actual}% / ${g.planned}%`}</Text>
            </Row>
            <Progress pct={g.actual} colour={gap != null && gap < 0 ? colors.amber : colors.green} />
          </Card>
        ) : null}
        <Card style={{ marginTop: 8 }}>
          {facts.map(([k, v], i) => (
            <Row key={k} wrap gap={8} style={{ paddingVertical: 5, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <Text style={{ width: 220, color: colors.muted }}>{k}</Text>
              <Text style={{ flex: 1, minWidth: 220, color: colors.ink }}>{v}</Text>
            </Row>
          ))}
          <Muted>{`Last week: ${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}`}</Muted>
        </Card>
        {lists.map((l) => (
          <Card key={l.title} style={{ marginTop: 8, borderLeftWidth: 4, borderLeftColor: l.tone === 'red' ? colors.red : l.tone === 'amber' ? colors.amber : colors.line }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{`${l.title} (${l.items.length})`}</Text>
            <View style={{ gap: 2, marginTop: 4 }}>
              {l.items.map((x, i) => (
                <Text key={i} style={{ color: colors.text }}>{`• ${x}`}</Text>
              ))}
            </View>
          </Card>
        ))}
      </Section>
      <Section title="Discussion and actions">{general}</Section>
    </>
  );
}
