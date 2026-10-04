import { Stack } from 'expo-router';
import { Text } from 'react-native';
import { MeetingActions } from '@/components/MeetingActions';
import { captureLocation } from '@/components/VisitBits';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
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
};

const STATUS: Record<MyMeeting['my_status'], { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: colors.blue },
  present: { label: 'Present', tone: colors.green },
  location_check: { label: 'Waiting for SM Projects – location differs', tone: colors.amber },
  absent: { label: 'Absent', tone: colors.red },
  excused: { label: 'Leave approved', tone: colors.grey },
};

/** Internal meetings: my invitations, attendance (with location), leave requests, and actions given to me. */
export default function InternalMeetings() {
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => rpc<MyMeeting[]>('my_meetings'));
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const today = todayISO();
  const now = new Date();
  const beforeStart = (d: string) => d > today || (d === today && now.getHours() * 60 + now.getMinutes() < 8 * 60 + 30);
  const beforeNoon = now.getHours() < 12;

  const markPresent = async (m: MyMeeting) => {
    const loc = await captureLocation();
    if (
      !loc &&
      !(await dialog.confirm('Location not available', 'Without your location SM Projects must approve your attendance. Continue?', {
        confirmLabel: 'Continue',
      }))
    )
      return;
    await dialog.run(async () => {
      const st = await rpc<string>('attend_sales_meeting', { p_meeting: m.meeting_id, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null });
      await reload();
      if (st !== 'present') dialog.toast('Your location differs from the meeting – SM Projects will approve your attendance', 'error');
    }, 'Attendance recorded');
  };
  const applyLeave = async (m: MyMeeting) => {
    const r = await dialog.prompt({
      title: `Leave from the sales meeting – Monday ${fmtDate(m.meeting_date)}`,
      message: 'SM Projects must approve it before the meeting starts (08:30).',
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
    });
    if (r)
      await dialog.run(async () => {
        await rpc('request_meeting_exception', { p_date: m.meeting_date, p_reason: r.r });
        await reload();
      }, 'Sent to SM Projects');
  };

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: 'Internal meetings' }} />
      <MeetingActions />
      <Section title="My meetings">
        {data.length ? (
          data.map((m) => (
            <Card key={m.meeting_id} style={{ marginBottom: 8 }}>
              <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Sales meeting · Monday {fmtDate(m.meeting_date)} · 08:30 – 12:00</Text>
                <Pill label={STATUS[m.my_status].label} tone={STATUS[m.my_status].tone} />
              </Row>
              <Muted>{`Host: ${m.host ?? 'SM Projects'}${m.checkin_at ? ` · marked ${fmtDateTime(m.checkin_at)}` : ''}${m.distance_m != null ? ` · ${Math.round(m.distance_m)} m from the meeting` : ''}`}</Muted>
              {m.leave_status ? (
                <Notice tone={m.leave_status === 'approved' ? colors.blue : m.leave_status === 'pending' ? colors.amber : colors.red}>
                  {`Leave ${m.leave_status === 'pending' ? 'requested – waiting for SM Projects' : m.leave_status}: ${m.leave_reason ?? ''}${m.leave_note ? ` · ${m.leave_note}` : ''}`}
                </Notice>
              ) : null}
              <Row wrap gap={8} style={{ marginTop: 6 }}>
                {m.meeting_date === today && beforeNoon && (m.my_status === 'invited' || m.my_status === 'location_check') ? (
                  m.started ? (
                    <Button title="I'm here – mark present" onPress={() => markPresent(m)} />
                  ) : (
                    <Muted>Mark present once SM Projects starts the meeting.</Muted>
                  )
                ) : null}
                {beforeStart(m.meeting_date) && m.my_status === 'invited' && (!m.leave_status || m.leave_status === 'rejected') ? (
                  <Button variant="secondary" title="Apply for leave" onPress={() => applyLeave(m)} />
                ) : null}
              </Row>
            </Card>
          ))
        ) : (
          <Card>
            <Empty title="No meeting invitations" hint="Invitations from SM Projects appear here." />
          </Card>
        )}
      </Section>
    </Screen>
  );
}
