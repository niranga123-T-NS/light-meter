import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, colors, Loading, Muted, Pill, Row } from '@/components/ui';
import { fmtDateTime, human } from '@/lib/format';
import { rpc } from '@/lib/supabase';

export type StageTime = {
  stage: string;
  n: number;
  avg_hours: number;
  median_hours?: number;
  p90_hours: number;
  target_hours?: number;
  on_time?: number;
  late?: number;
};
export type Journey = { n: number; median_hours: number | null; p90_hours: number | null };
type Late = { inquiry_id: string | null; code: string | null; project: string | null; owner: string | null; due_at: string; stopped_at: string; used_hours: number; target_hours: number; delay_reason: string | null };

// The inquiry's journey, in order: who does each stage. Anything else (manager approvals) is listed after it.
const JOURNEY: { group: string; stage: string; label: string; who: string }[] = [
  { group: 'Sales → team', stage: 'acceptance', label: 'Accept the inquiry', who: 'Design Manager / SM Estimation' },
  { group: 'Sales → team', stage: 'assignment', label: 'Assign a designer / estimator', who: 'Design Manager / SM Estimation' },
  { group: 'Sales → team', stage: 'ack', label: 'Acknowledge the job', who: 'Designer / estimator' },
  { group: 'Design', stage: 'design', label: 'Design', who: 'Lighting designer' },
  { group: 'Design', stage: 'design_review', label: 'Design review', who: 'Design Manager' },
  { group: 'Estimation', stage: 'estimation', label: 'Estimation', who: 'Estimator' },
  { group: 'Release', stage: 'quotation_approval', label: 'Approve the quotation', who: 'SM Estimation' },
  { group: 'Release', stage: 'approval_quotation_sm_projects', label: 'SM Projects approves the quotation', who: 'SM Projects' },
  { group: 'Release', stage: 'sales_submission', label: 'Submit to the client', who: 'Sales person' },
];

const USUAL = colors.blue;
const SLOW = '#BFD0F7';
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/** Dashboard card: how long inquiries take – the whole journey, then each stage in order against its target. */
export function StageTimes({ stages, journey, hoursPerDay, from, to }: { stages: StageTime[]; journey: Journey | null; hoursPerDay: number; from: string; to: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [late, setLate] = useState<Record<string, Late[] | 'loading' | string>>({});
  const hpd = hoursPerDay || 9;
  const t = (h: number | null | undefined) => {
    if (h == null) return '—';
    const v = Number(h);
    if (v < 1) return '< 1 h';
    if (v < hpd) return `${Math.round(v)} h`;
    const d = v / hpd;
    return `${d >= 10 ? d.toFixed(0) : d.toFixed(1).replace(/\.0$/, '')} d`;
  };
  const by = new Map(stages.map((s) => [s.stage, s]));
  const main = JOURNEY.filter((j) => by.has(j.stage)).map((j) => ({ ...j, s: by.get(j.stage)! }));
  const others = stages.filter((s) => !JOURNEY.some((j) => j.stage === s.stage));
  const usual = (s: StageTime) => Number(s.median_hours ?? s.avg_hours);
  const scale = Math.max(1, ...main.map((m) => Math.max(Number(m.s.p90_hours), Number(m.s.target_hours ?? 0))));
  const tot = main.reduce((a, m) => ({ on: a.on + Number(m.s.on_time ?? 0), n: a.n + Number(m.s.n) }), { on: 0, n: 0 });
  const worst = [...main].sort((a, b) => Number(b.s.late ?? 0) - Number(a.s.late ?? 0))[0];

  const toggle = async (stage: string) => {
    if (open === stage) return setOpen(null);
    setOpen(stage);
    if (late[stage]) return;
    setLate((x) => ({ ...x, [stage]: 'loading' }));
    try {
      const rows = await rpc<Late[]>('sla_stage_late', { p_stage: stage, p_from: from, p_to: to });
      setLate((x) => ({ ...x, [stage]: rows }));
    } catch (e) {
      setLate((x) => ({ ...x, [stage]: (e as Error).message }));
    }
  };
  const lateList = (stage: string) => {
    const l = late[stage];
    if (l === 'loading') return <Loading />;
    if (typeof l === 'string') return <Muted>{l}</Muted>;
    if (!l?.length) return <Muted>None over target in this period.</Muted>;
    return (
      <View style={{ gap: 4, paddingLeft: 8, borderLeftWidth: 3, borderLeftColor: colors.red, marginBottom: 6 }}>
        {l.map((x, i) => (
          <Text key={i} style={{ color: colors.text, fontSize: 13 }}>
            {`${x.code ?? ''} ${x.project ?? ''} · ${x.owner ?? '—'} · took ${t(x.used_hours)} (target ${t(x.target_hours)}) · finished ${fmtDateTime(x.stopped_at)}${x.delay_reason ? ` · ${x.delay_reason}` : ' · no reason given'}`}
          </Text>
        ))}
      </View>
    );
  };

  const groups = [...new Set(main.map((m) => m.group))];
  return (
    <Card style={{ marginTop: 8 }}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>How long inquiries take</Text>
      <Row wrap gap={10} style={{ marginTop: 8 }}>
        <Head value={journey?.n ? t(journey.median_hours) : '—'} label={`Typical inquiry, submitted → quotation to the client${journey?.n ? ` (${journey.n} inquiries)` : ''}`} />
        <Head value={journey?.n ? t(journey.p90_hours) : '—'} label="1 in 10 take longer than this" tone={colors.amber} />
        <Head value={worst && Number(worst.s.late) ? worst.label : 'None'} label={worst && Number(worst.s.late) ? `Most cases over target · ${worst.s.late} of ${worst.s.n}` : 'No stage over target'} tone={worst && Number(worst.s.late) ? colors.red : colors.green} />
        <Head value={tot.n ? `${pctOf(tot.on, tot.n)}%` : '—'} label="Stages finished on time (by the agreed date)" tone={tot.n && (pctOf(tot.on, tot.n) ?? 0) >= 90 ? colors.green : colors.amber} />
      </Row>
      <Row wrap gap={14} style={{ marginTop: 10, alignItems: 'center' }}>
        <Legend colour={USUAL} label="Usual time (half finish faster)" />
        <Legend colour={SLOW} label="Slow cases (1 in 10 take longer)" />
        <Row gap={6} style={{ alignItems: 'center' }}>
          <View style={{ width: 2, height: 14, backgroundColor: colors.ink }} />
          <Muted>Target</Muted>
        </Row>
        <Muted>{`Working time · 1 day = ${hpd} h · tap a stage for the late ones`}</Muted>
      </Row>
      {groups.map((g) => (
        <View key={g} style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted, textTransform: 'uppercase', borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 4 }}>{g}</Text>
          {main
            .filter((m) => m.group === g)
            .map((m) => {
              const s = m.s;
              const p = pctOf(Number(s.on_time ?? 0), Number(s.n));
              const few = Number(s.n) < 3;
              const tone = few || p == null ? colors.grey : p >= 90 ? colors.green : p >= 75 ? colors.amber : colors.red;
              return (
                <View key={m.stage}>
                  <Pressable onPress={() => toggle(m.stage)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                    <View style={{ width: 230, maxWidth: '100%' }}>
                      <Text style={{ fontWeight: '600', color: colors.ink }}>{m.label}</Text>
                      <Muted>{`${m.who} · ${s.n} done`}</Muted>
                    </View>
                    <View style={{ flex: 1, minWidth: 200, height: 22, justifyContent: 'center' }}>
                      <View style={{ position: 'absolute', left: 0, top: 6, height: 10, borderRadius: 3, width: `${(Number(s.p90_hours) / scale) * 100}%`, backgroundColor: SLOW }} />
                      <View style={{ position: 'absolute', left: 0, top: 6, height: 10, borderRadius: 3, width: `${Math.max((usual(s) / scale) * 100, 1)}%`, backgroundColor: USUAL }} />
                      {s.target_hours != null ? <View style={{ position: 'absolute', top: 0, height: 22, width: 2, left: `${Math.min((Number(s.target_hours) / scale) * 100, 99.5)}%`, backgroundColor: colors.ink }} /> : null}
                    </View>
                    <View style={{ width: 150, alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: colors.ink, fontWeight: '600' }}>{`${t(usual(s))} · slow ${t(s.p90_hours)}`}</Text>
                      <Muted>{`target ${t(s.target_hours)}`}</Muted>
                    </View>
                    <View style={{ width: 150, alignItems: 'flex-end', gap: 2 }}>
                      <Pill label={few ? 'Too few to judge' : `${p ?? '—'}% on time`} tone={tone} />
                      <Muted>{Number(s.late) ? `${s.late} over target ›` : 'none late'}</Muted>
                    </View>
                  </Pressable>
                  {open === m.stage ? lateList(m.stage) : null}
                </View>
              );
            })}
        </View>
      ))}
      {others.length ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: colors.muted, textTransform: 'uppercase', borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 4 }}>Manager approvals</Text>
          {others.map((s) => (
            <View key={s.stage}>
              <Pressable onPress={() => toggle(s.stage)} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ color: colors.ink }}>
                  {human(s.stage.replace(/^approval_/, ''))}
                  <Text style={{ color: colors.muted }}>{` · ${s.n}${Number(s.n) < 3 ? ' – too few to judge' : ''}`}</Text>
                </Text>
                <Text style={{ color: Number(s.late) ? colors.red : colors.text }}>{`${t(usual(s))} · slow ${t(s.p90_hours)}${Number(s.late) ? ` · ${s.late} late ›` : ''}`}</Text>
              </Pressable>
              {open === s.stage ? lateList(s.stage) : null}
            </View>
          ))}
        </View>
      ) : null}
      {!stages.length ? <Muted>No completed stages in this period.</Muted> : null}
    </Card>
  );
}

function Head({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 180, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, gap: 2 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: tone ?? colors.ink }}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <Row gap={6} style={{ alignItems: 'center' }}>
      <View style={{ width: 18, height: 10, borderRadius: 3, backgroundColor: colour }} />
      <Muted>{label}</Muted>
    </Row>
  );
}
