import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Body, Button, Card, ErrorBanner, Grid, Loading, Muted, Pill, Progress, Row, Section, Segmented, Stat, colors } from '@/components/ui';
import { DIMO_LOGO_DATA_URI } from '@/lib/brandLogoData';
import { printHtml } from '@/lib/export';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import { type AcademyBadgeDef, type AcademyCourseState, type AcademyLeader, type AcademyMe, FAMILY_LABELS, STATUS_COLOURS, STATUS_LABELS, TIER_COLOURS, certificateHtml, courseLabel } from '@/lib/academy';

const STATUS_HINTS: Record<string, string> = {
  ahead: 'Well ahead of your plan – keep it up.',
  on_track: 'On track for your target date.',
  behind: 'Behind your plan – a few lessons this week will close the gap.',
  idle: 'No activity for two weeks – pick up where you left off.',
  complete: 'Every required course is complete.',
  open: 'Your courses are optional – learn at your own pace.',
};

/** One course on the path: lessons and module tests, with the certificate once complete */
function CourseCard({ c, name }: { c: AcademyCourseState; name: string }) {
  const dialog = useDialog();
  const items = c.lessons + c.tests, done = c.lessons_done + c.tests_passed;
  const cert = () =>
    dialog.run(() =>
      printHtml(
        certificateHtml({
          name,
          course: courseLabel(c.course),
          date: fmtDate(c.completed_at),
          detail: `${c.lessons} lessons${c.tests ? ` · ${c.tests} module tests (${c.tests_90} at 90 % or more)` : ''}`,
          logo: DIMO_LOGO_DATA_URI,
          serial: `DAC-${c.course.toUpperCase()}-${(c.completed_at ?? '').slice(0, 10).replace(/-/g, '')}`,
        }),
        { key: 'academy_certificate', filters: `${name} · ${courseLabel(c.course)}`, title: `Certificate – ${courseLabel(c.course)}`, landscape: true },
      ),
    );
  return (
    <Card style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ fontWeight: '700' }}>{courseLabel(c.course)}</Body>
        <Pill label={c.complete ? 'Complete' : c.required ? 'Required' : 'Optional'} tone={c.complete ? colors.green : c.required ? colors.brand : colors.grey} />
      </Row>
      <Progress pct={items ? (100 * done) / items : 0} colour={c.complete ? colors.green : colors.brand} />
      <Muted>{`${c.lessons_done} / ${c.lessons} lessons${c.tests ? ` · ${c.tests_passed} / ${c.tests} module tests` : ''}`}</Muted>
      {c.complete ? <Button small variant="secondary" title="🎓 Certificate" onPress={cert} /> : null}
    </Card>
  );
}

/** The badge wall: every badge, earned ones in colour with the date, locked ones greyed with how to earn them */
export function BadgeWall({ earned }: { earned: AcademyMe['badges'] }) {
  const { data } = useLoad(async () => {
    const { data, error } = await supabase.from('academy_badge_defs').select('*').order('sort');
    if (error) throw new Error(error.message);
    return data as AcademyBadgeDef[];
  }, []);
  if (!data) return <Loading />;
  const fams = [...new Set(data.map((d) => d.family))];
  return (
    <View style={{ gap: 10 }}>
      {fams.map((f) => (
        <View key={f} style={{ gap: 6 }}>
          <Muted style={{ fontWeight: '700' }}>{FAMILY_LABELS[f]}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {data
              .filter((d) => d.family === f)
              .map((d) => {
                const got = earned.filter((b) => b.key === d.key);
                const on = got.length > 0, tone = TIER_COLOURS[d.tier];
                return (
                  <View key={d.key} style={{ width: 170, padding: 10, borderRadius: 12, borderWidth: 2, borderColor: on ? tone : colors.line, backgroundColor: on ? `${tone}12` : colors.soft, opacity: on ? 1 : 0.6, gap: 3 }}>
                    <Row gap={6}>
                      <Text style={{ fontSize: 22 }}>{on ? d.icon : '🔒'}</Text>
                      <Text style={{ fontWeight: '700', color: on ? tone : colors.muted, flexShrink: 1 }}>{d.name}</Text>
                    </Row>
                    <Muted style={{ fontSize: 12 }}>{d.rule}</Muted>
                    <Muted style={{ fontSize: 11 }}>{`${d.tier.charAt(0).toUpperCase() + d.tier.slice(1)}${d.points ? ` · +${d.points} pts` : ''}${d.auto ? '' : ' · awarded by the trainer'}`}</Muted>
                    {on ? <Muted style={{ fontSize: 11, color: tone }}>{got.length > 1 ? `Earned ${got.length}×, last ${fmtDate(got[got.length - 1].awarded_at)}` : `Earned ${fmtDate(got[0].awarded_at)}`}</Muted> : null}
                  </View>
                );
              })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Top learners this month, per team */
export function AcademyLeaders() {
  const { data, error } = useLoad(() => rpc<AcademyLeader[]>('academy_leaders'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  if (!data.length) return <Muted>No points yet this month.</Muted>;
  const teams = [...new Set(data.map((d) => d.team))];
  return (
    <Grid min={240}>
      {teams.map((t) => (
        <Card key={t} style={{ gap: 4 }}>
          <Body style={{ fontWeight: '700' }}>{t}</Body>
          {data
            .filter((d) => d.team === t)
            .slice(0, 3)
            .map((d, i) => (
              <Row key={d.user_id} style={{ justifyContent: 'space-between' }}>
                <Body numberOfLines={1} style={{ flexShrink: 1 }}>{`${['🥇', '🥈', '🥉'][i]} ${d.full_name}`}</Body>
                <Muted>{`${d.points} pts`}</Muted>
              </Row>
            ))}
        </Card>
      ))}
    </Grid>
  );
}

/** A person's Dacademy: level, points, plan status, courses, badges and spot checks (own, or a team member's for the coach) */
export function AcademyProfile({ d, own }: { d: AcademyMe; own: boolean }) {
  const st = d.state, lv = d.level;
  const toNext = lv.next ? Math.round((100 * (d.points - lv.from)) / (lv.next - lv.from)) : 100;
  const courses = d.courses.filter((c) => c.required || c.optional || c.lessons_done + c.tests_passed > 0).sort((a, b) => Number(b.required) - Number(a.required));
  return (
    <View style={{ gap: 8 }}>
      <Card style={{ gap: 8 }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View>
            <Body style={{ fontSize: 20, fontWeight: '800' }}>{`L${lv.level} ${lv.name}`}</Body>
            <Muted>{`${d.full_name} · ${ROLE_LABELS[d.role] ?? d.role}`}</Muted>
          </View>
          <Pill solid label={STATUS_LABELS[st.status]} tone={STATUS_COLOURS[st.status]} />
        </Row>
        <Progress pct={toNext} colour={colors.amber} />
        <Muted>{lv.next ? `${d.points} points · ${lv.next - d.points} to L${lv.level + 1}` : `${d.points} points · top level`}</Muted>
        <Muted>{own ? STATUS_HINTS[st.status] : `Plan: ${STATUS_LABELS[st.status]}`}</Muted>
      </Card>
      <Grid min={160} max={4}>
        <Stat label="Required path" value={st.items ? `${st.done} / ${st.items}` : '—'} sub={st.items ? `${st.expected} expected by today` : undefined} />
        <Stat label="This week" value={st.pace ? `${st.this_week} / ${st.pace}` : String(st.this_week)} tone={st.pace && st.this_week >= st.pace ? 'green' : undefined} sub={st.pace ? 'weekly target' : undefined} />
        <Stat label="Streak" value={`${d.streak} wk`} sub="weekly target met" />
        <Stat label="This month" value={`${d.month_points} pts`} sub={d.path.target_on ? `Target ${fmtDate(d.path.target_on)}` : undefined} />
      </Grid>
      <Section title="Courses">
        <Grid min={240}>{courses.map((c) => <CourseCard key={c.course} c={c} name={d.full_name} />)}</Grid>
      </Section>
      <Section title={`Badges (${new Set(d.badges.map((b) => b.key)).size} of 24)`}>
        <BadgeWall earned={d.badges} />
      </Section>
      {d.spotchecks.length ? (
        <Section title="Spot checks">
          {d.spotchecks.map((s, i) => (
            <Card key={i} style={{ gap: 2 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Body style={{ fontWeight: '600' }}>{s.topic}</Body>
                <Pill label={s.result === 'pass' ? 'Pass' : 'Needs work'} tone={s.result === 'pass' ? colors.green : colors.amber} />
              </Row>
              <Muted>{`${fmtDate(s.checked_on)} · ${s.by}${s.note ? ` · ${s.note}` : ''}`}</Muted>
            </Card>
          ))}
        </Section>
      ) : null}
    </View>
  );
}

/** My Dacademy: the learner's own page, with the month's top learners */
export function AcademyMePage() {
  const [tab, setTab] = useState<'me' | 'top'>('me');
  const { data, error } = useLoad(() => rpc<AcademyMe>('academy_me'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  return (
    <View style={{ gap: 8 }}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'me', label: 'My progress' }, { value: 'top', label: 'Top learners this month' }]} />
      {tab === 'me' ? <AcademyProfile d={data} own /> : <AcademyLeaders />}
    </View>
  );
}
