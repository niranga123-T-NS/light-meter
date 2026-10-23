import { router } from 'expo-router';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useDialog } from '@/components/dialog';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { projectNo } from '@/lib/execution';
import { hhmm, nextMeetingDate, type Team, TEAMS } from '@/lib/meetings';
import { rpc, supabase } from '@/lib/supabase';

type Meeting = {
  id: string;
  meeting_date: string;
  held_on: string | null;
  status: 'draft' | 'published';
  generated_at: string | null;
  published_at: string | null;
  initiated_at: string | null;
  starts_at: string;
  ends_at: string;
  exec_projects?: { name: string; code: string | null; wbs_no: string | null } | null;
};
type InviteRequest = { meeting_id: string; team: Team; meeting_date: string; starts_at: string; ends_at: string; person_id: string; person: string; requested_by: string };
type Reschedule = {
  id: string;
  week_of: string;
  from_date: string;
  from_starts: string;
  from_ends: string;
  to_date: string;
  to_starts: string;
  to_ends: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  requested_by: string;
  decision_note: string | null;
};
type Exception = { id: string; sales_person_id: string; meeting_date: string; reason: string; status: 'pending' | 'approved' | 'rejected'; decision_note: string | null };

const isTime = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
const slot = (d: string, a: string, b: string) => `${weekday(d)} ${fmtDate(d)} ${hhmm(a)} – ${hhmm(b)}`;

/** One team's meetings: the host invites, generates and publishes the pack and decides leave; GM / DGM (and SM Projects for
 * Estimation and Design) read the published packs. */
export function TeamMeetingsPanel({ team }: { team: Team }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const cfg = TEAMS[team];
  const host = me.role === cfg.hostRole;
  const { data, error, reload } = useLoad(async () => {
    const [m, e, inv, rs] = await Promise.all([
      supabase
        .from('sales_meetings')
        .select(team === 'project' ? 'id, meeting_date, held_on, status, generated_at, published_at, initiated_at, starts_at, ends_at, exec_projects(name, code, wbs_no)' : 'id, meeting_date, held_on, status, generated_at, published_at, initiated_at, starts_at, ends_at')
        .eq('team', team)
        .order('meeting_date', { ascending: false })
        .limit(52),
      supabase.from('meeting_exceptions').select('*').eq('team', team).gte('meeting_date', addDaysISO(todayISO(), -28)).order('meeting_date', { ascending: false }),
      me.role === 'sm_projects' && team !== 'sales' ? rpc<InviteRequest[]>('meeting_invites_to_approve').catch(() => [] as InviteRequest[]) : Promise.resolve([] as InviteRequest[]),
      team === 'sales' && (me.role === 'sm_projects' || me.role === 'gm')
        ? supabase.from('meeting_reschedules').select('*').gte('requested_at', `${addDaysISO(todayISO(), -42)}T00:00:00`).order('requested_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    if (m.error) throw new Error(m.error.message);
    return { meetings: (m.data ?? []) as Meeting[], exceptions: (e.data ?? []) as Exception[], invites: inv.filter((x) => x.team === team), moves: (rs.data ?? []) as Reschedule[] };
  }, [team]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const upcoming = nextMeetingDate(team);
  const today = todayISO();
  const dayOf = (m: { meeting_date: string; held_on?: string | null }) => m.held_on ?? m.meeting_date;
  const next = data.meetings.filter((m) => dayOf(m) >= today && m.status === 'draft').sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))[0];
  const target = next ?? null;
  const date = target?.meeting_date ?? upcoming;
  const pending = data.exceptions.filter((e) => e.status === 'pending');
  const movePending = data.moves.filter((x) => x.status === 'pending');

  // SM Projects asks to move a week's sales meeting; GM / DGM approve
  const askMove = async () => {
    const cur = target ?? null;
    const r = await dialog.prompt({
      title: 'Move the sales meeting',
      message: 'Choose the new day (Monday to Saturday of the same week) and time. GM / DGM approve it; then the invitees and the sales team are told, and visits in the new time are flagged.',
      fields: [
        { key: 'd', label: 'New day', type: 'date', required: true, initial: cur ? dayOf(cur) : date },
        { key: 's', label: 'Starts (HH:MM)', required: true, initial: hhmm(cur?.starts_at) || cfg.starts },
        { key: 'e', label: 'Ends (HH:MM)', required: true, initial: hhmm(cur?.ends_at) || cfg.ends },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
    });
    if (!r) return;
    if (!isTime(r.s) || !isTime(r.e)) return dialog.toast('Enter the times as HH:MM, e.g. 14:00', 'error');
    await dialog.run(async () => {
      await rpc('request_meeting_reschedule', { p_week: r.d, p_date: r.d, p_starts: r.s.trim(), p_ends: r.e.trim(), p_reason: r.r });
      await reload();
    }, 'Sent to GM / DGM for approval');
  };
  const decideMove = async (x: Reschedule, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve moving the sales meeting' : 'Do not approve the move',
      message: `${slot(x.from_date, x.from_starts, x.from_ends)} → ${slot(x.to_date, x.to_starts, x.to_ends)} · ${x.reason}`,
      fields: [{ key: 'n', label: approve ? 'Note' : 'Reason', type: 'multiline', required: !approve }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_meeting_reschedule', { p_id: x.id, p_approve: approve, p_note: r.n || null });
      await reload();
    }, approve ? 'Approved – the meeting is moved and everyone is told' : 'Not approved – SM Projects is told');
  };

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
  const when = (m: { meeting_date: string; held_on?: string | null; starts_at?: string; ends_at?: string }) =>
    `${team === 'sales' ? `${weekday(dayOf(m))} ` : ''}${fmtDate(dayOf(m))} · ${hhmm(m.starts_at) || cfg.starts} – ${hhmm(m.ends_at) || cfg.ends}${m.held_on ? ' (moved)' : ''}`;

  return (
    <>
      <Card>
        <Muted>
          {team === 'sales'
            ? 'Every Monday 08:30 – 12:00, run by SM Projects. SM Projects can move a week’s meeting to another day or time of that week with GM / DGM approval. Invite the team by Sunday 10:00 (GM / DGM are told if it is not done by 15:00). Sales persons cannot plan visits in the meeting time without approved leave.'
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
            {team === 'sales' ? <Button variant="secondary" title="Move the meeting" onPress={askMove} /> : null}
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
          <Muted>{me.role === 'sm_projects' ? `Every ${cfg.label.toLowerCase()} – drafts while ${cfg.host} prepares them, and the published minutes (read only).` : `Packs appear here once ${cfg.host} publishes them (read only).`}</Muted>
        )}
      </Card>

      {movePending.length ? (
        <Section title={me.role === 'gm' ? `Sales meeting moves to approve (${movePending.length})` : 'Move waiting for GM / DGM'}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {movePending.map((x) => (
              <ListRow
                key={x.id}
                wrapRight
                title={`${slot(x.from_date, x.from_starts, x.from_ends)} → ${slot(x.to_date, x.to_starts, x.to_ends)}`}
                subtitle={`${x.reason} · asked by ${people[x.requested_by]?.full_name ?? 'SM Projects'}`}
                right={
                  me.role === 'gm' ? (
                    <Row gap={6}>
                      <Button small title="Approve" onPress={() => decideMove(x, true)} />
                      <Button small variant="secondary" title="Reject" onPress={() => decideMove(x, false)} />
                    </Row>
                  ) : host ? (
                    <Button
                      small
                      variant="secondary"
                      title="Withdraw"
                      onPress={() =>
                        dialog.run(async () => {
                          await rpc('withdraw_meeting_reschedule', { p_id: x.id });
                          await reload();
                        }, 'Withdrawn')
                      }
                    />
                  ) : null
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}
      {data.moves.some((x) => x.status === 'approved' || x.status === 'rejected') ? (
        <Notice tone={colors.blue}>
          {data.moves
            .filter((x) => x.status === 'approved' || x.status === 'rejected')
            .slice(0, 3)
            .map((x) => `${x.status === 'approved' ? 'Moved' : 'Move not approved'}: ${slot(x.from_date, x.from_starts, x.from_ends)} → ${slot(x.to_date, x.to_starts, x.to_ends)}${x.decision_note ? ` – ${x.decision_note}` : ''}`)
            .join('\n')}
        </Notice>
      ) : null}

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
                title={m.exec_projects ? `${projectNo(m.exec_projects)} ${m.exec_projects.name} · ${when(m)}`.trim() : when(m)}
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
