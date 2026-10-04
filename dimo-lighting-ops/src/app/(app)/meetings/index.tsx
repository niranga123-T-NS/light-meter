import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { MeetingActions } from '@/components/MeetingActions';
import { TeamMeetingsPanel } from '@/components/TeamMeetingsPanel';
import { captureLocation } from '@/components/VisitBits';
import { WeekMeetings } from '@/components/WeekMeetings';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { hhmm, isTeam, type Team, TEAMS, teamsFor } from '@/lib/meetings';
import { rpc } from '@/lib/supabase';

type MyMeeting = {
  meeting_id: string;
  meeting_date: string;
  started: boolean;
  my_status: 'invited' | 'present' | 'location_check' | 'absent' | 'excused';
  checkin_at: string | null;
  distance_m: number | null;
  leave_status: 'pending' | 'approved' | 'rejected' | null;
  leave_reason: string | null;
  leave_note: string | null;
  host: string | null;
  team: Team;
  title: string;
  starts_at: string;
  ends_at: string;
};

const STATUS: Record<MyMeeting['my_status'], { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: colors.blue },
  present: { label: 'Present', tone: colors.green },
  location_check: { label: 'Waiting for the host – location differs', tone: colors.amber },
  absent: { label: 'Absent', tone: colors.red },
  excused: { label: 'Leave approved', tone: colors.grey },
};

/** Meetings: one place for the sales, estimation and design meetings – my invitations, attendance, leave and actions
 * ("Mine"), and a tab per team the person runs or reads. */
export default function Meetings() {
  const me = useMe();
  const params = useLocalSearchParams<{ team?: string }>();
  const teams = teamsFor(me.role);
  const tab: 'mine' | Team = isTeam(params.team) && teams.some((t) => t.team === params.team) ? params.team : 'mine';
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Meetings' }} />
      {teams.length ? (
        <Segmented
          value={tab}
          onChange={(v) => router.setParams({ team: v === 'mine' ? undefined : v })}
          options={[{ value: 'mine', label: 'Mine' }, ...teams.map((t) => ({ value: t.team, label: TEAMS[t.team].short }))]}
        />
      ) : null}
      {tab === 'mine' ? <Mine /> : <TeamMeetingsPanel key={tab} team={tab} />}
    </Screen>
  );
}

function Mine() {
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => rpc<MyMeeting[]>('my_meetings'));
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const today = todayISO();
  const nowHm = new Date().toTimeString().slice(0, 5);
  const beforeStart = (m: MyMeeting) => m.meeting_date > today || (m.meeting_date === today && nowHm < hhmm(m.starts_at));
  const beforeEnd = (m: MyMeeting) => m.meeting_date === today && nowHm < hhmm(m.ends_at);

  const markPresent = async (m: MyMeeting) => {
    const loc = await captureLocation();
    if (
      !loc &&
      !(await dialog.confirm('Location not available', 'Without your location the host must approve your attendance. Continue?', {
        confirmLabel: 'Continue',
      }))
    )
      return;
    await dialog.run(async () => {
      const st = await rpc<string>('attend_sales_meeting', { p_meeting: m.meeting_id, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null });
      await reload();
      if (st !== 'present') dialog.toast(`Your location differs from the meeting – ${TEAMS[m.team].host} will approve your attendance`, 'error');
    }, 'Attendance recorded');
  };
  const applyLeave = async (m: MyMeeting) => {
    const r = await dialog.prompt({
      title: `Leave from the ${m.title.toLowerCase()} – ${fmtDate(m.meeting_date)}`,
      message: `${TEAMS[m.team].host} must approve it before the meeting starts (${hhmm(m.starts_at)}).`,
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
    });
    if (r)
      await dialog.run(async () => {
        await rpc('request_meeting_leave', { p_meeting: m.meeting_id, p_reason: r.r });
        await reload();
      }, `Sent to ${TEAMS[m.team].host}`);
  };

  return (
    <>
      <WeekMeetings title="This week" />
      <MeetingActions />
      <Section title="My invitations">
        {data.length ? (
          data.map((m) => (
            <Card key={m.meeting_id} style={{ marginBottom: 8 }}>
              <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                  {`${m.title} · ${fmtDate(m.meeting_date)} · ${hhmm(m.starts_at)} – ${hhmm(m.ends_at)}`}
                </Text>
                <Pill label={STATUS[m.my_status].label} tone={STATUS[m.my_status].tone} />
              </Row>
              <Muted>{`Host: ${m.host ?? TEAMS[m.team].host}${m.checkin_at ? ` · marked ${fmtDateTime(m.checkin_at)}` : ''}${m.distance_m != null ? ` · ${Math.round(m.distance_m)} m from the meeting` : ''}`}</Muted>
              {m.leave_status ? (
                <Notice tone={m.leave_status === 'approved' ? colors.blue : m.leave_status === 'pending' ? colors.amber : colors.red}>
                  {`Leave ${m.leave_status === 'pending' ? `requested – waiting for ${TEAMS[m.team].host}` : m.leave_status}: ${m.leave_reason ?? ''}${m.leave_note ? ` · ${m.leave_note}` : ''}`}
                </Notice>
              ) : null}
              <Row wrap gap={8} style={{ marginTop: 6 }}>
                {beforeEnd(m) && (m.my_status === 'invited' || m.my_status === 'location_check') ? (
                  m.started ? (
                    <Button title="I'm here – mark present" onPress={() => markPresent(m)} />
                  ) : (
                    <Muted>{`Mark present once ${TEAMS[m.team].host} starts the meeting.`}</Muted>
                  )
                ) : null}
                {beforeStart(m) && m.my_status === 'invited' && (!m.leave_status || m.leave_status === 'rejected') ? (
                  <Button variant="secondary" title="Apply for leave" onPress={() => applyLeave(m)} />
                ) : null}
              </Row>
            </Card>
          ))
        ) : (
          <Card>
            <Empty title="No meeting invitations" hint="Invitations to the sales, estimation and design meetings appear here." />
          </Card>
        )}
      </Section>
    </>
  );
}
