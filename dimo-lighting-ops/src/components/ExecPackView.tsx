import type { ReactNode } from 'react';
import { Card, colors, Grid, KeyValue, Muted, Notice, Section, Stat } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import type { TeamPack } from './TeamPackView';

type Job = { code: string; project: string; person?: string; due?: string; days?: number; reason?: string | null };
type Person = {
  id: string;
  name: string;
  in_hand_n: number;
  done_week_n: number;
  on_hold_n: number;
  overdue: Job[];
  due_soon: Job[];
  open_actions: { action: string; due: string | null; owner: string }[];
  exception: { status: string; reason: string } | null;
};
const num = (v: unknown) => Number(v ?? 0);
const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Execution team meeting pack: engineering jobs across the team, then a part per engineer / supervisor. */
export function ExecPackView({ pack, general, personFooter }: { team: string; pack: TeamPack; general: ReactNode; personFooter: (id: string) => ReactNode }) {
  const t = pack.team as Record<string, unknown>;
  const j = (t.jobs ?? {}) as Record<string, number>;
  const done = num(t.done_week_n);
  const onTime = done ? Math.round((num(t.done_on_time_n) / done) * 100) : null;
  const line = (title: string, rows: Job[], f: (x: Job) => string, tone?: string) =>
    rows.length ? <Notice tone={tone ?? colors.amber}>{`${title}: ${rows.map((x) => `${x.code} ${x.project}${f(x)}`).join(' · ')}`}</Notice> : null;
  const people = pack.people as unknown as Person[];
  return (
    <>
      <Section title={`Team · last week ${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}`}>
        <Grid min={150}>
          <Stat label="Jobs in hand" value={num(j.total)} />
          <Stat label="Awaiting acceptance" value={num(j.assigned)} tone={num(j.assigned) ? 'amber' : undefined} />
          <Stat label="Ongoing" value={num(j.in_progress)} />
          <Stat label="On hold" value={num(j.on_hold)} tone={num(j.on_hold) ? 'red' : undefined} />
          <Stat label="Done last week" value={done} tone="green" />
          <Stat label="Done on time" value={onTime == null ? '—' : `${onTime}%`} tone={onTime == null ? undefined : onTime >= 80 ? 'green' : onTime >= 60 ? 'amber' : 'red'} />
          <Stat label="Overdue" value={num(t.overdue_n)} tone={num(t.overdue_n) ? 'red' : undefined} />
          <Stat label="Due in 7 days" value={num(t.due_soon_n)} />
        </Grid>
        <Card style={{ marginTop: 8, gap: 6 }}>
          {line('Overdue', list<Job>(t.overdue), (x) => ` (${x.person ?? '—'}, ${x.days} d late)`, colors.red)}
          {line('On hold', list<Job>(t.on_hold), (x) => ` (${x.person ?? '—'} – ${x.reason ?? 'no reason'})`, colors.red)}
          {line('Not accepted yet', list<Job>(t.not_accepted), (x) => ` (${x.person ?? '—'})`)}
          {line('Due in 7 days', list<Job>(t.due_soon), (x) => ` (${x.person ?? '—'}, due ${fmtDate(x.due)})`, colors.blue)}
          {list<{ code: string; name: string; stage: number }>(t.projects).length ? (
            <Muted>{`Active projects: ${list<{ code: string; name: string; stage: number }>(t.projects).map((x) => `${x.code} ${x.name} (stage ${x.stage})`).join(' · ')}`}</Muted>
          ) : null}
        </Card>
        {general}
      </Section>
      {people.map((p) => (
        <Section key={p.id} title={p.name}>
          <Card>
            {p.exception ? <Notice tone={p.exception.status === 'approved' ? colors.blue : colors.amber}>{`Leave from the meeting ${p.exception.status}: ${p.exception.reason}`}</Notice> : null}
            <Grid min={160}>
              <KeyValue label="Jobs in hand" value={String(p.in_hand_n)} />
              <KeyValue label="On hold" value={String(p.on_hold_n)} />
              <KeyValue label="Done last week" value={String(p.done_week_n)} />
              <KeyValue label="Overdue" value={String(p.overdue.length)} />
            </Grid>
            {p.overdue.length ? <Muted>{`Overdue: ${p.overdue.map((x) => `${x.code} ${x.project} ${x.days} d`).join(' · ')}`}</Muted> : null}
            {p.due_soon.length ? <Muted>{`Due soon: ${p.due_soon.map((x) => `${x.code} ${x.project} ${fmtDate(x.due)}`).join(' · ')}`}</Muted> : null}
            {p.open_actions.length ? (
              <Notice tone={colors.amber}>{`Open actions from earlier meetings: ${p.open_actions.map((a) => `${a.action} (${a.owner}${a.due ? `, by ${fmtDate(a.due)}` : ''})`).join(' · ')}`}</Notice>
            ) : null}
            {personFooter(p.id)}
          </Card>
        </Section>
      ))}
    </>
  );
}
