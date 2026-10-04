import type { ReactNode } from 'react';
import { Card, colors, Grid, KeyValue, Muted, Notice, Section, Stat } from '@/components/ui';
import { mn } from '@/lib/finance';
import { fmtDate } from '@/lib/format';
import type { Team } from '@/lib/meetings';

type Job = { code: string; project: string; person?: string; due?: string; days?: number; status?: string; task?: string; progress?: number };
type OpenAction = { action: string; due: string | null; meeting: string; owner: string };
type Person = {
  id: string;
  name: string;
  in_hand_n: number;
  released_week_n: number;
  overdue: Job[];
  due_soon: Job[];
  avg_days: number | Record<string, number> | null;
  returns_n?: number;
  review_returns?: number;
  hours_week?: number;
  open_actions: OpenAction[];
  exception: { status: string; reason: string } | null;
};
export type TeamPack = {
  team_kind: 'estimation' | 'design';
  week_from: string;
  week_to: string;
  generated_at: string;
  team: Record<string, unknown> & { in_hand: Record<string, number> };
  people: Person[];
};

const num = (v: unknown) => Number(v ?? 0);
const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
const jobs = (rows: Job[], f: (j: Job) => string) => rows.map((j) => `${j.code} ${j.project}${f(j)}`).join(' · ');

/** Estimation / Design meeting pack: team summary and lists, then a part per person (with the meeting's notes and actions). */
export function TeamPackView({ team, pack, general, personFooter }: { team: Team; pack: TeamPack; general: ReactNode; personFooter: (id: string) => ReactNode }) {
  const t = pack.team;
  const h = t.in_hand ?? {};
  const est = team === 'estimation';
  const rel = num(t.released_jobs_n ?? t.released_n);
  const onTime = rel ? Math.round((num(t.released_on_time_n) / rel) * 100) : null;
  const hit = (t.hit ?? {}) as { won?: number; lost?: number };
  const hitPct = num(hit.won) + num(hit.lost) ? Math.round((num(hit.won) / (num(hit.won) + num(hit.lost))) * 100) : null;
  const block = (title: string, rows: Job[], f: (j: Job) => string, tone?: string) =>
    rows.length ? (
      <Notice tone={tone ?? colors.amber}>
        {`${title}: `}
        {jobs(rows, f)}
      </Notice>
    ) : null;

  return (
    <>
      <Section title={`Team · last week ${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}`}>
        <Grid min={150}>
          <Stat label="Jobs in hand" value={num(h.total)} />
          {est ? (
            <>
              <Stat label="New / not assigned" value={num(h.new)} tone={num(h.new) ? 'amber' : undefined} />
              <Stat label="Waiting approval (SM / GM)" value={num(h.approval)} />
              <Stat label={`Quotations released · ${mn(num(t.released_value))} Mn`} value={num(t.released_n)} tone="green" />
            </>
          ) : (
            <>
              <Stat label="In design" value={num(h.in_progress)} />
              <Stat label="In review" value={num(h.in_review)} />
              <Stat label="Released last week" value={num(t.released_n)} tone="green" />
            </>
          )}
          <Stat label="Released on time" value={onTime == null ? '—' : `${onTime}%`} tone={onTime == null ? undefined : onTime >= 80 ? 'green' : onTime >= 60 ? 'amber' : 'red'} />
          <Stat label="Overdue" value={num(t.overdue_n)} tone={num(t.overdue_n) ? 'red' : undefined} />
          <Stat label={est ? 'At risk (7 days)' : 'Due in 7 days'} value={num(est ? t.at_risk_n : t.due_soon_n)} tone={num(est ? t.at_risk_n : t.due_soon_n) ? 'amber' : undefined} />
          <Stat label="Returned" value={num(h.returned)} tone={num(h.returned) ? 'amber' : undefined} />
          <Stat label="On hold" value={num(h.on_hold)} />
          {est ? (
            <>
              <Stat
                label={`Open clarifications${t.clarifications_oldest ? ` · oldest ${num(t.clarifications_oldest)} d` : ''}`}
                value={num(t.clarifications_n)}
                tone={num(t.clarifications_n) ? 'amber' : undefined}
              />
              <Stat label={`Hit rate (90 days) · ${num(hit.won)} won / ${num(hit.lost)} lost`} value={hitPct == null ? '—' : `${hitPct}%`} />
              <Stat label="Waiting on Design" value={num(t.waiting_design_n)} tone={num(t.waiting_design_n) ? 'amber' : undefined} />
            </>
          ) : (
            <>
              <Stat label="Waiting on sales information" value={num(t.waiting_info_n)} tone={num(t.waiting_info_n) ? 'amber' : undefined} />
              <Stat label="Released to Estimation, not started" value={num(t.waiting_estimation_n)} />
              <Stat label="Early releases to sales" value={num(t.early_releases_n)} />
              <Stat label="Hours logged last week" value={num(t.hours_week)} />
            </>
          )}
        </Grid>
        <Card style={{ marginTop: 8, gap: 6 }}>
          {block('Overdue', list<Job>(t.overdue), (j) => ` (${j.person ?? '—'}, ${j.days} d late)`, colors.red)}
          {est
            ? block('At risk', list<Job>(t.at_risk), (j) => ` (${j.person ?? '—'}, due ${fmtDate(j.due)})`)
            : block('Due in 7 days', list<Job>(t.due_soon), (j) => ` (${j.person ?? '—'}, due ${fmtDate(j.due)}, ${j.progress ?? 0}%)`)}
          {list<Job & { reason: string | null; revision?: number; cycles?: number }>(t.returned).length ? (
            <Notice tone={colors.amber}>
              {`Returned: ${list<Job & { reason: string | null; revision?: number; cycles?: number }>(t.returned)
                .map((j) => `${j.code} ${j.project} (${j.person ?? '—'}${j.reason ? ` – ${j.reason}` : ''}${est ? `, R${j.revision ?? 0}` : `, ${j.cycles ?? 0} reviews`})`)
                .join(' · ')}`}
            </Notice>
          ) : null}
          {list<Job & { reason: string | null; waiting_on?: string | null }>(t.on_hold).length ? (
            <Muted>
              {`On hold: ${list<Job & { reason: string | null; waiting_on?: string | null }>(t.on_hold)
                .map((j) => `${j.code} ${j.project} (${j.reason ?? 'no reason'}${j.waiting_on ? `, waiting on ${j.waiting_on}` : ''})`)
                .join(' · ')}`}
            </Muted>
          ) : null}
          {est && list<{ code: string; question: string; by: string; days: number }>(t.clarifications).length ? (
            <Muted>
              {`Open clarifications: ${list<{ code: string; question: string; by: string; days: number }>(t.clarifications)
                .map((c) => `${c.code} – ${c.question} (${c.by}, ${c.days} d)`)
                .join(' · ')}`}
            </Muted>
          ) : null}
          {est && list<{ code: string; project: string; status: string; design_due: string | null }>(t.waiting_design).length ? (
            <Muted>
              {`Waiting on Design: ${list<{ code: string; project: string; status: string; design_due: string | null }>(t.waiting_design)
                .map((c) => `${c.code} ${c.project}${c.design_due ? ` (design due ${fmtDate(c.design_due)})` : ''}`)
                .join(' · ')}`}
            </Muted>
          ) : null}
          {!est && list<{ code: string; project: string; sales: string; since: string }>(t.waiting_info).length ? (
            <Muted>
              {`Waiting on sales information: ${list<{ code: string; project: string; sales: string; since: string }>(t.waiting_info)
                .map((c) => `${c.code} ${c.project} (${c.sales}, since ${fmtDate(c.since)})`)
                .join(' · ')}`}
            </Muted>
          ) : null}
        </Card>
        {general}
      </Section>

      {pack.people.map((p) => (
        <Section key={p.id} title={p.name}>
          <Card>
            {p.exception ? (
              <Notice tone={p.exception.status === 'approved' ? colors.blue : colors.amber}>{`Leave from the meeting ${p.exception.status}: ${p.exception.reason}`}</Notice>
            ) : null}
            <Grid min={160}>
              <KeyValue label="Jobs in hand" value={String(p.in_hand_n)} />
              <KeyValue label="Released last week" value={String(p.released_week_n)} />
              <KeyValue label="Overdue" value={String(p.overdue.length)} />
              <KeyValue label="Due in 7 days" value={String(p.due_soon.length)} />
              <KeyValue
                label={est ? 'Average turnaround (90 days)' : 'Average design time (90 days)'}
                value={
                  p.avg_days == null
                    ? '—'
                    : typeof p.avg_days === 'number'
                      ? `${p.avg_days} d`
                      : Object.entries(p.avg_days)
                          .map(([k, v]) => `${k} ${v} d`)
                          .join(' · ')
                }
              />
              <KeyValue label={est ? 'Returns / revisions' : 'Review returns (90 days)'} value={String(est ? (p.returns_n ?? 0) : (p.review_returns ?? 0))} />
              {!est ? <KeyValue label="Hours logged last week" value={String(p.hours_week ?? 0)} /> : null}
            </Grid>
            {p.overdue.length ? <Muted>{`Overdue: ${jobs(p.overdue, (j) => ` ${j.days} d`)}`}</Muted> : null}
            {p.due_soon.length ? <Muted>{`Due soon: ${jobs(p.due_soon, (j) => ` ${fmtDate(j.due)}`)}`}</Muted> : null}
            {p.open_actions.length ? (
              <Notice tone={colors.amber}>
                {`Open actions from earlier meetings: ${p.open_actions.map((a) => `${a.action} (${a.owner}${a.due ? `, by ${fmtDate(a.due)}` : ''})`).join(' · ')}`}
              </Notice>
            ) : null}
            {personFooter(p.id)}
          </Card>
        </Section>
      ))}
    </>
  );
}
