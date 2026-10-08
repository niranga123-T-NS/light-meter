import type { ReactNode } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
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
      {pack.timeline ? <Timeline t={pack.timeline} /> : null}
      <Section title="Discussion and actions">{general}</Section>
    </>
  );
}

/** A stored SVG drawn at the card's width (kept to scale) */
function Chart({ xml, width }: { xml: string; width: number }) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(xml);
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [1020, 260];
  // The SVG parser here shows entities as typed – put the characters back (they are text only, never markup)
  const txt = xml.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return <SvgXml xml={txt} width={width} height={(width * h) / w} />;
}

function Timeline({ t }: { t: NonNullable<ProjectPack['timeline']> }) {
  const win = useWindowDimensions().width;
  const width = Math.max(300, Math.min(1000, win - (win >= 900 ? 330 : 56)));
  const gw = Math.max(width, 760); // the Gantt scrolls sideways on phones
  return (
    <Section title="Tracked timeline">
      <Card>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Gantt</Text>
        <Muted>{`${t.gantt_note} · grey line = baseline · red = critical · green = finished · red vertical line = meeting day`}</Muted>
        <ScrollView horizontal>
          <View style={{ gap: 4, marginTop: 6 }}>
            {t.gantt.map((g, i) => (
              <Chart key={i} xml={g} width={gw} />
            ))}
          </View>
        </ScrollView>
      </Card>
      {t.scurve ? (
        <Card style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Progress S-curve</Text>
          <Muted>Dashed = planned (baseline) · blue = actual · red = meeting day</Muted>
          <Chart xml={t.scurve} width={width - 32} />
        </Card>
      ) : null}
      {t.weeks.length ? (
        <Card style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>Weekly tracking</Text>
          <ScrollView horizontal>
            <View>
              {[{ week: 'Week of', planned: 'Planned', actual: 'Actual', v: 'Variance', forecast: 'Forecast finish', critical: 'Critical open', head: true }, ...t.weeks.map((w) => ({ ...w, v: w.actual - w.planned, head: false }))].map((w, i) => (
                <Row key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line, paddingVertical: 4 }}>
                  {[
                    w.head ? String(w.week) : fmtDate(String(w.week)),
                    w.head ? String(w.planned) : `${w.planned}%`,
                    w.head ? String(w.actual) : `${w.actual}%`,
                    w.head ? String(w.v) : `${Number(w.v) > 0 ? '+' : ''}${w.v}%`,
                    w.head ? String(w.forecast) : w.forecast ? fmtDate(String(w.forecast)) : '—',
                    String(w.critical),
                  ].map((c, k) => (
                    <Text
                      key={k}
                      style={{
                        width: k === 0 || k === 4 ? 120 : 90,
                        textAlign: k === 0 || k === 4 ? 'left' : 'right',
                        paddingRight: 8,
                        fontWeight: w.head ? '700' : '400',
                        color: w.head ? colors.muted : k === 3 && Number(w.v) < 0 ? colors.red : colors.ink,
                      }}
                    >
                      {c}
                    </Text>
                  ))}
                </Row>
              ))}
            </View>
          </ScrollView>
        </Card>
      ) : null}
    </Section>
  );
}
