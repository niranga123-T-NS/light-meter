import { router } from 'expo-router';
import { MeetingActions } from '@/components/MeetingActions';
import { Card, colors, ListRow, Pill, Section } from '@/components/ui';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { hhmm, type Team, TEAMS } from '@/lib/meetings';
import { rpc } from '@/lib/supabase';

type WeekMeeting = {
  meeting_id: string | null;
  team: Team;
  title: string;
  meeting_date: string;
  starts_at: string;
  ends_at: string;
  my_part: 'host' | 'invitee' | 'viewer';
  my_status: string | null;
  status: 'draft' | 'published' | 'not_set_up';
  started: boolean;
  generated: boolean;
};

const MY_STATUS: Record<string, { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: colors.blue },
  present: { label: 'Present', tone: colors.green },
  location_check: { label: 'Location check', tone: colors.amber },
  absent: { label: 'Absent', tone: colors.red },
  excused: { label: 'On leave', tone: colors.grey },
};

/** My Day: this week's meetings – the ones I am invited to, run, or (GM / DGM, SM Projects) follow. */
export function WeekMeetings({ title = "This week's meetings" }: { title?: string }) {
  const { data } = useLoad(() => rpc<WeekMeeting[]>('my_week_meetings').catch(() => [] as WeekMeeting[]));
  if (!data?.length) return null;
  const today = todayISO();
  return (
    <Section title={`${title} (${data.length})`}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {data.map((m) => {
          const past = m.meeting_date < today;
          const pill =
            m.status === 'not_set_up'
              ? { label: 'Not set up – invite the team', tone: colors.red }
              : m.my_part === 'invitee' && m.my_status
                ? MY_STATUS[m.my_status]
                : m.status === 'published'
                  ? { label: 'Published', tone: colors.green }
                  : m.my_part === 'host'
                    ? { label: m.generated ? 'Pack ready' : 'Pack not generated', tone: m.generated ? colors.blue : colors.amber }
                    : { label: 'Scheduled', tone: colors.blue };
          return (
            <ListRow
              key={`${m.team}-${m.meeting_date}`}
              highlight={m.meeting_date === today ? colors.brand : undefined}
              title={`${m.title} · ${new Date(`${m.meeting_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} ${fmtDate(m.meeting_date)} · ${hhmm(m.starts_at)} – ${hhmm(m.ends_at)}`}
              subtitle={`${m.my_part === 'host' ? 'You run it' : m.my_part === 'invitee' ? `Host: ${TEAMS[m.team].host}` : `Run by ${TEAMS[m.team].host}`}${m.meeting_date === today ? ' · today' : past ? ' · done' : ''}${m.started && m.meeting_date === today ? ' · started' : ''}`}
              right={<Pill label={pill.label} tone={pill.tone} />}
              onPress={() =>
                m.my_part === 'invitee' || !m.meeting_id
                  ? router.push(m.meeting_id ? '/meetings' : `/meetings?team=${m.team}`)
                  : // GM / DGM open a meeting once its host has published the pack
                    m.my_part !== 'host' && m.status !== 'published'
                    ? router.push(`/meetings?team=${m.team}`)
                    : router.push(`/meeting/${m.meeting_id}`)
              }
            />
          );
        })}
      </Card>
    </Section>
  );
}

/** My Day block: this week's meetings and the meeting follow-ups I do, appoint or track. */
export function MyDayMeetings() {
  return (
    <>
      <WeekMeetings />
      <MeetingActions />
    </>
  );
}
