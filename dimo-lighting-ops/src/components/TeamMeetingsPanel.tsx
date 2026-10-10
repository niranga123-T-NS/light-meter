import { router } from 'expo-router';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Pill, Row, Section } from '@/components/ui';
import { useDialog } from '@/components/dialog';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { hhmm, nextMeetingDate, type Team, TEAMS } from '@/lib/meetings';
import { rpc, supabase } from '@/lib/supabase';

type Meeting = {
  id: string;
  meeting_date: string;
  status: 'draft' | 'published';
  generated_at: string | null;
  published_at: string | null;
  initiated_at: string | null;
  starts_at: string;
  ends_at: string;
};
type InviteRequest = { meeting_id: string; team: Team; meeting_date: string; starts_at: string; ends_at: string; person_id: string; person: string; requested_by: string };
type Exception = { id: string; sales_person_id: string; meeting_date: string; reason: string; status: 'pending' | 'approved' | 'rejected'; decision_note: string | null };

/** One team's meetings: the host invites, generates and publishes the pack and decides leave; GM / DGM (and SM Projects for
 * Estimation and Design) read the published packs. */
export function TeamMeetingsPanel({ team }: { team: Team }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const cfg = TEAMS[team];
  const host = me.role === cfg.hostRole;
  const { data, error, reload } = useLoad(async () => {
    const [m, e, inv] = await Promise.all([
      supabase
        .from('sales_meetings')
        .select('id, meeting_date, status, generated_at, published_at, initiated_at, starts_at, ends_at')
        .eq('team', team)
        .order('meeting_date', { ascending: false })
        .limit(52),
      supabase.from('meeting_exceptions').select('*').eq('team', team).gte('meeting_date', addDaysISO(todayISO(), -28)).order('meeting_date', { ascending: false }),
      me.role === 'sm_projects' && team !== 'sales' ? rpc<InviteRequest[]>('meeting_invites_to_approve').catch(() => [] as InviteRequest[]) : Promise.resolve([] as InviteRequest[]),
    ]);
    if (m.error) throw new Error(m.error.message);
    return { meetings: (m.data ?? []) as Meeting[], exceptions: (e.data ?? []) as Exception[], invites: inv.filter((x) => x.team === team) };
  }, [team]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const upcoming = nextMeetingDate(team);
  const today = todayISO();
  const next = data.meetings.filter((m) => m.meeting_date >= today && m.status === 'draft').sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  const target = next ?? null;
  const date = target?.meeting_date ?? upcoming;
  const pending = data.exceptions.filter((e) => e.status === 'pending');

  const generate = async (d: string) => {
    await dialog.run(async () => {
      const id = await rpc<string>('generate_team_meeting', { p_team: team, p_date: d });
      await reload();
      router.push(`/meeting/${id}`);
    }, 'Meeting pack generated');
  };
  const decide = async (e: Exception, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the leave' : 'Do not approve',
      message: `${people[e.sales_person_id]?.full_name ?? ''} · ${fmtDate(e.meeting_date)} · ${e.reason}`,
      fields: [{ key: 'n', label: approve ? 'Note' : 'Reason', type: 'multiline', required: !approve }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_meeting_exception', { p_id: e.id, p_approve: approve, p_note: r.n || null });
      await reload();
    }, approve ? 'Approved' : 'Not approved');
  };
  const decideInvite = async (x: InviteRequest, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? `Approve – invite ${x.person}` : `Do not invite ${x.person}`,
      message: `${cfg.label} · ${fmtDate(x.meeting_date)} ${hhmm(x.starts_at)} – ${hhmm(x.ends_at)} · requested by ${x.requested_by}`,
      fields: [{ key: 'n', label: approve ? 'Note' : 'Reason', type: 'multiline', required: !approve }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_meeting_invite', { p_meeting: x.meeting_id, p_person: x.person_id, p_approve: approve, p_note: r.n || null });
      await reload();
    }, approve ? 'Approved – invitation sent' : 'Not approved – the host is told');
  };
  const when = (m: { meeting_date: string; starts_at?: string; ends_at?: string }) =>
    `${fmtDate(m.meeting_date)} · ${hhmm(m.starts_at) || cfg.starts} – ${hhmm(m.ends_at) || cfg.ends}`;

  return (
    <>
      <Card>
        <Muted>
          {team === 'sales'
            ? 'Every Monday 08:30 – 12:00, run by SM Projects. Invite the team by Sunday 10:00 (GM / DGM are told if it is not done by 15:00). Sales persons cannot plan visits in the meeting time without approved leave.'
            : `Run by ${cfg.host}. Choose the day and time when inviting (usually ${['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][cfg.dow]} ${cfg.starts} – ${cfg.ends}); GM / DGM are told if it is not set up by 15:00 the day before. Published packs go to GM / DGM and SM Projects.`}{' '}
          Invitees mark attendance and apply for leave in Meetings → Mine.
        </Muted>
        {host ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button
              variant={target?.initiated_at ? 'secondary' : 'primary'}
              title={target?.initiated_at ? `Invitees – ${when(target)}` : `Invite the team – ${fmtDate(date)}`}
              onPress={() => router.push({ pathname: '/meeting/invite', params: { team, date } })}
            />
            <Button
              variant={target?.initiated_at ? 'primary' : 'secondary'}
              title={target?.generated_at ? `Open the pack – ${fmtDate(date)}` : `Generate the pack – ${fmtDate(date)}`}
              onPress={() => (target?.generated_at ? router.push(`/meeting/${target.id}`) : generate(date))}
            />
            <Button
              variant="secondary"
              title={team === 'sales' ? 'Another Monday' : 'Another date'}
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Invite for another date', fields: [{ key: 'd', label: 'Date', type: 'date', required: true, initial: upcoming }] });
                if (r) router.push({ pathname: '/meeting/invite', params: { team, date: r.d } });
              }}
            />
          </Row>
        ) : (
          <Muted>Packs appear here once {cfg.host} publishes them (read only).</Muted>
        )}
      </Card>

      {data.invites.length ? (
        <Section title={`Invitations to approve – outside the team (${data.invites.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.invites.map((x) => (
              <ListRow
                key={`${x.meeting_id}-${x.person_id}`}
                wrapRight
                title={`${x.person} · ${fmtDate(x.meeting_date)} ${hhmm(x.starts_at)} – ${hhmm(x.ends_at)}`}
                subtitle={`Requested by ${x.requested_by} – the invitation is sent only after you approve`}
                right={
                  <Row gap={6}>
                    <Button small title="Approve" onPress={() => decideInvite(x, true)} />
                    <Button small variant="secondary" title="Reject" onPress={() => decideInvite(x, false)} />
                  </Row>
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {host && pending.length ? (
        <Section title={`Leave requests to approve (${pending.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pending.map((e) => (
              <ListRow
                key={e.id}
                wrapRight
                title={`${people[e.sales_person_id]?.full_name ?? '—'} · ${fmtDate(e.meeting_date)}`}
                subtitle={e.reason}
                right={
                  <Row gap={6}>
                    <Button small title="Approve" onPress={() => decide(e, true)} />
                    <Button small variant="secondary" title="Reject" onPress={() => decide(e, false)} />
                  </Row>
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={`${cfg.label}s`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.meetings.length ? (
            data.meetings.map((m) => (
              <ListRow
                key={m.id}
                title={when(m)}
                subtitle={
                  m.status === 'published'
                    ? `Published ${fmtDateTime(m.published_at)}`
                    : m.generated_at
                      ? `Generated ${fmtDateTime(m.generated_at)} · draft`
                      : m.initiated_at
                        ? 'Invited · pack not generated yet'
                        : 'Draft'
                }
                wrapRight
                right={
                  <Row gap={6} wrap>
                    {m.status === 'published' ? (
                      <Button small variant="secondary" title="Status review" onPress={() => router.push(`/meeting/review/${m.id}`)} />
                    ) : null}
                    <Pill label={m.status === 'published' ? 'Published' : 'Draft'} tone={m.status === 'published' ? colors.green : colors.amber} />
                  </Row>
                }
                onPress={() => router.push(`/meeting/${m.id}`)}
              />
            ))
          ) : (
            <Empty title={host ? 'No meetings yet' : 'No published packs yet'} />
          )}
        </Card>
      </Section>

      {host && data.exceptions.some((e) => e.status !== 'pending') ? (
        <Section title="Recent leave requests">
          <Card>
            {data.exceptions
              .filter((e) => e.status !== 'pending')
              .map((e) => (
                <Muted key={e.id}>
                  {`${fmtDate(e.meeting_date)} · ${people[e.sales_person_id]?.full_name ?? '—'} · ${e.status}${e.decision_note ? ` – ${e.decision_note}` : ''} · ${e.reason}`}
                </Muted>
              ))}
          </Card>
        </Section>
      ) : null}
    </>
  );
}
