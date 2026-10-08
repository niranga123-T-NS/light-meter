import { router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { hhmm } from '@/lib/meetings';
import { supabase } from '@/lib/supabase';

type Meeting = {
  id: string;
  meeting_date: string;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'published';
  agenda: string | null;
  generated_at: string | null;
  started_at: string | null;
  sales_meeting_invitees: { status: string }[];
};

/** A project's meetings: the Senior Electrical Engineer calls them (agenda, invitees, the project's figures) and runs them like the
 * team meetings. GM / DGM and SM Projects read the published ones; the invited project team opens theirs. */
export function MeetingsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const host = me.role === 'senior_elec_engineer';
  const { data, error } = useLoad(async () => {
    const { data: m, error: e } = await supabase
      .from('sales_meetings')
      .select('id, meeting_date, starts_at, ends_at, status, agenda, generated_at, started_at, sales_meeting_invitees(status)')
      .eq('team', 'project')
      .eq('exec_project_id', p.id)
      .order('meeting_date', { ascending: false })
      .order('starts_at', { ascending: false });
    if (e) throw new Error(e.message);
    return (m ?? []) as Meeting[];
  }, [p.id]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const today = todayISO();
  const row = (m: Meeting) => {
    const inv = m.sales_meeting_invitees.filter((x) => x.status !== 'pending_approval');
    const present = inv.filter((x) => x.status === 'present').length;
    const past = m.meeting_date < today;
    return (
      <ListRow
        key={m.id}
        title={`${new Date(`${m.meeting_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} ${fmtDate(m.meeting_date)} · ${hhmm(m.starts_at)} – ${hhmm(m.ends_at)}`}
        subtitle={[
          m.agenda,
          m.started_at || past ? `${present} of ${inv.length} present` : `${inv.length} invited`,
          m.status === 'draft' ? (m.generated_at ? 'figures generated' : 'figures not generated yet') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <Pill
            label={m.status === 'published' ? 'Published' : m.meeting_date === today ? 'Today' : past ? 'To publish' : 'Called'}
            tone={m.status === 'published' ? colors.green : m.meeting_date === today ? colors.blue : past ? colors.red : colors.amber}
          />
        }
        onPress={() => router.push(`/meeting/${m.id}`)}
      />
    );
  };
  const upcoming = data.filter((m) => m.status === 'draft').sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  const done = data.filter((m) => m.status === 'published');
  return (
    <>
      <Section
        title="Project meetings"
        right={
          host && p.status === 'active' ? (
            <Button small title="+ Call a meeting" onPress={() => router.push({ pathname: '/meeting/invite', params: { team: 'project', project: p.id } })} />
          ) : undefined
        }
      >
        <Card>
          <Muted>
            {host
              ? 'Call a meeting about this project: set the date, time and agenda and choose the invitees (the project team at once; anyone else after SM Projects approves). On the meeting page, generate the project figures – programme progress, plan, daily reports, HSE, QA, materials, variations, design queries, billing and cost – record the discussion and actions, and publish to GM / DGM and SM Projects.'
              : 'Meetings about this project, called by the Senior Electrical Engineer. Invitees mark attendance in Meetings; published minutes go to GM / DGM and SM Projects.'}
          </Muted>
        </Card>
      </Section>
      {upcoming.length ? (
        <Section title="Called / to publish">
          <Card style={{ padding: 0, overflow: 'hidden' }}>{upcoming.map(row)}</Card>
        </Section>
      ) : null}
      <Section title={`Published (${done.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {done.length ? done.map(row) : <Empty title="No published project meetings" />}
        </Card>
      </Section>
      {!data.length && !host ? (
        <Row>
          <Text style={{ color: colors.text }}>No meetings for this project yet.</Text>
        </Row>
      ) : null}
    </>
  );
}
