import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { pctTone } from '@/components/financeTones';
import { useDialog } from '@/components/dialog';
import { MeetingActionForm, type ActionDraft } from '@/components/MeetingActionForm';
import { isTeamKind, kindLabel } from '@/lib/meetingActions';
import { hhmm, type Team, TEAMS } from '@/lib/meetings';
import { ExecPackView } from '@/components/ExecPackView';
import { ProjectPackView } from '@/components/exec/ProjectPackView';
import { projectNo, type ExecProject } from '@/lib/execution';
import { buildProjectPack, projectFacts, timelineHtml, type ProjectPack } from '@/lib/projectMeeting';
import { TeamPackView, type TeamPack } from '@/components/TeamPackView';
import { captureLocation } from '@/components/VisitBits';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { amt, fmtPct, mn } from '@/lib/finance';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { printHtml } from '@/lib/export';
import { execPerson, execTeam, type MinutesAction, minutesHtml, salesPerson, salesTeam, teamPerson, teamTeam } from '@/lib/meetingMinutes';
import { ROLE_LABELS, ROLE_SHORT } from '@/lib/roles';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Person = {
  id: string;
  name: string;
  target: { budget_secure: number; secured: number; budget_invoice: number; invoiced: number; secured_pct: number; invoiced_pct: number; score: number };
  wins: { code: string; project: string; customer: string | null; value: number }[];
  losses: { code: string; project: string; customer: string | null; reason: string | null }[];
  quotes_waiting_n: number;
  quotes_waiting: { code: string; project: string; customer: string | null; days: number }[];
  followups_overdue_n: number;
  followups_overdue: { date: string; customer: string; action: string | null }[];
  visits: { planned: number; completed: number; missed: number; done: number };
  not_visited_n: number;
  not_visited: { project: string; value: number; last_visit: string | null }[];
  invoices: { slipped_n: number; slipped: number; due_month: number };
  debtors_90: { n: number; lkr: number };
  retentions_due: { n: number; lkr: number };
  open_actions: { action: string; due: string | null; meeting: string; owner: string }[];
  exception: { status: string; reason: string } | null;
};
type Pack = {
  meeting_date: string;
  week_from: string;
  week_to: string;
  generated_at: string;
  team: Record<string, number>;
  people: Person[];
};
type Meeting = {
  id: string;
  team: Team;
  starts_at: string;
  ends_at: string;
  meeting_date: string;
  status: 'draft' | 'published';
  pack: Pack | null;
  notes: string | null;
  generated_at: string | null;
  published_at: string | null;
  started_at: string | null;
  exec_project_id: string | null;
  agenda: string | null;
};
type Leave = { id: string; sales_person_id: string; reason: string; status: 'pending' | 'approved' | 'rejected'; decision_note: string | null };
type Note = { sales_person_id: string; note: string };
type Action = {
  id: string;
  sales_person_id: string | null;
  owner_id: string;
  action: string;
  due_date: string | null;
  status: 'open' | 'done';
  new_project: string | null;
  new_customer: string | null;
  kind: string;
  assignee_id: string | null;
  done_note: string | null;
  done_at: string | null;
  objective: string | null;
  projects: { name: string } | null;
  organizations: { name: string } | null;
  org_units: { name: string } | null;
};
type Invitee = { person_id: string; status: 'pending_approval' | 'invited' | 'present' | 'location_check' | 'absent' | 'excused'; checkin_at: string | null; distance_m: number | null; note: string | null };
const ATT: Record<Invitee['status'], { label: string; tone: string }> = {
  pending_approval: { label: 'Waiting for SM Projects to approve the invitation', tone: colors.amber },
  invited: { label: 'Not marked yet', tone: colors.grey },
  present: { label: 'Present', tone: colors.green },
  location_check: { label: 'Location differs – approve', tone: colors.red },
  absent: { label: 'Absent', tone: colors.red },
  excused: { label: 'Leave approved', tone: colors.blue },
};

const bar = (label: string, done: number, target: number, value: number) => (
  <View style={{ gap: 3 }}>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text }}>{label}</Text>
      <Text style={{ fontWeight: '700', color: colors.ink }}>
        {mn(done)} / {mn(target)} Mn · {fmtPct(value)}
      </Text>
    </Row>
    <Progress pct={value} colour={pctTone(value)} />
  </View>
);

/** One meeting pack (sales, estimation or design): team summary, a part per person with notes and actions. The host edits until
 * published; GM / DGM (and SM Projects for Estimation / Design) read. */
export default function MeetingPack() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [m, n, a, i] = await Promise.all([
      supabase.from('sales_meetings').select('*').eq('id', id).maybeSingle(),
      supabase.from('sales_meeting_notes').select('*').eq('meeting_id', id),
      supabase.from('sales_meeting_actions').select('*, projects(name), organizations(name), org_units(name)').eq('meeting_id', id).order('created_at'),
      supabase.from('sales_meeting_invitees').select('*').eq('meeting_id', id),
    ]);
    if (m.error) throw new Error(m.error.message);
    if (!m.data) return null;
    const ex = m.data.exec_project_id as string | null;
    const [ep, lv] = ex
      ? await Promise.all([
          supabase.from('exec_projects').select('*').eq('id', ex).maybeSingle(),
          supabase.from('meeting_exceptions').select('id, sales_person_id, reason, status, decision_note').eq('meeting_id', id),
        ])
      : [{ data: null }, { data: [] }];
    // a project meeting's actions are for that project and its customer
    const ep2 = (ep.data ?? null) as ExecProject | null;
    const prj = ep2?.project_id
      ? ((await supabase.from('projects').select('organization_id, organizations(name)').eq('id', ep2.project_id).maybeSingle()).data as {
          organization_id: string | null;
          organizations: { name: string } | null;
        } | null)
      : null;
    return {
      prj,
      m: m.data as Meeting,
      notes: (n.data ?? []) as Note[],
      actions: (a.data ?? []) as Action[],
      invitees: (i.data ?? []) as Invitee[],
      project: (ep.data ?? null) as ExecProject | null,
      leave: (lv.data ?? []) as Leave[],
    };
  }, [id]);
  const [adding, setAdding] = useState<string | null>(null); // sales person id, 'general', or null
  // While a meeting is running today, attendance refreshes by itself (invitees mark present from their own phones)
  const live = !!data?.m.started_at && data.m.status === 'draft' && data.m.meeting_date === todayISO();
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => reload(), 15000);
    return () => clearInterval(t);
  }, [live, reload]);
  if (data === null)
    return (
      <Screen>
        <Notice tone={colors.amber}>
          This meeting cannot be opened yet – its pack has not been published. GM / DGM see a meeting once its host (SM Projects, SM Estimation, Design Manager or
          the Senior Electrical Engineer) publishes it. It may also have been removed.
        </Notice>
        <Button title="Go to Meetings" onPress={() => router.replace('/meetings')} />
      </Screen>
    );
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { m } = data;
  const cfg = TEAMS[m.team ?? 'sales'];
  const PackView = m.team === 'execution' ? ExecPackView : TeamPackView;
  const isProject = m.team === 'project';
  const label = isProject && data.project ? `Project meeting – ${projectNo(data.project)} ${data.project.name}` : cfg.label;
  // The host runs the meeting: SM Projects (sales), SM Estimation, Design Manager
  const host = me.role === cfg.hostRole;
  const edit = host && m.status === 'draft';
  const pack = m.pack;
  const t = pack?.team ?? {};
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  const editNote = async (personId: string | null, current: string) => {
    const r = await dialog.prompt({
      title: personId ? `Notes – ${people[personId]?.full_name ?? ''}` : 'Meeting notes',
      fields: [{ key: 'n', label: 'Discussion / decisions', type: 'multiline', initial: current }],
    });
    if (r) await run('save_meeting_note', { p_meeting: m.id, p_sales_person: personId, p_note: r.n ?? '' }, 'Saved');
  };
  // Anyone but GM / DGM and System Admin can be given an action
  const owners = Object.values(people)
    .filter((p) => p.active !== false && p.role !== 'gm' && p.role !== 'sys_admin')
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const saveAction = async (personId: string | null, a: ActionDraft) => {
    await run(
      'add_meeting_action',
      {
        p_meeting: m.id,
        p_data: {
          kind: a.kind,
          sales_person_id: personId,
          owner_id: a.owner_id,
          action: a.action,
          due_date: a.due_date,
          project_id: a.project_id,
          organization_id: a.organization_id,
          unit_id: a.unit_id,
          new_project: a.new_project,
          new_customer: a.new_customer,
          objective: a.objective,
        },
      },
      'Action added',
    );
    setAdding(null);
  };
  const today = todayISO();
  const isToday = m.meeting_date === today;
  const startMeeting = async () => {
    const loc = await captureLocation();
    if (!loc) return dialog.toast('Allow location access – the meeting location is where you start it', 'error');
    await run('start_sales_meeting', { p_id: m.id, p_lat: loc.lat, p_lng: loc.lng }, 'Meeting started – invitees can mark attendance');
  };
  const mine = data.invitees.find((x) => x.person_id === me.id);
  const markPresent = async () => {
    const loc = await captureLocation();
    if (!loc && !(await dialog.confirm('Location not available', 'Without your location the host must approve your attendance. Continue?', { confirmLabel: 'Continue' }))) return;
    await dialog.run(async () => {
      const st = await rpc<string>('attend_sales_meeting', { p_meeting: m.id, p_lat: loc?.lat ?? null, p_lng: loc?.lng ?? null });
      await reload();
      if (st !== 'present') dialog.toast(`Your location differs from the meeting – ${cfg.host} will approve your attendance`, 'error');
    }, 'Attendance recorded');
  };
  const decideAttendance = async (p: Invitee, present: boolean) => {
    const r = await dialog.prompt({
      title: present ? `Accept ${people[p.person_id]?.full_name ?? ''} as present` : `Mark ${people[p.person_id]?.full_name ?? ''} absent`,
      message: p.distance_m != null ? `Marked ${Math.round(p.distance_m)} m from the meeting location` : 'No location was shared',
      fields: [{ key: 'n', label: present ? 'Note' : 'Reason', type: 'multiline', required: !present }],
    });
    if (r) await run('decide_attendance', { p_meeting: m.id, p_person: p.person_id, p_present: present, p_note: r.n || null }, 'Saved');
  };
  // Published minutes as a PDF: GM / DGM and SM Projects
  const canDownload = m.status === 'published' && (me.role === 'gm' || me.role === 'sm_projects' || (isProject && host));
  // Project meeting: the project's figures are gathered here and kept with the meeting
  const generateProject = () =>
    dialog.run(async () => {
      if (!data.project) throw new Error('Project not found');
      const pk = await buildProjectPack(data.project, m.meeting_date);
      await rpc('save_project_meeting_pack', { p_id: m.id, p_pack: pk });
      await reload();
    }, 'Project figures generated – notes and actions kept');
  const cancelMeeting = async () => {
    const r = await dialog.prompt({
      title: 'Cancel this project meeting',
      message: 'The invitees are told. Notes and actions recorded so far are removed.',
      fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
      confirmLabel: 'Cancel meeting',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('cancel_project_meeting', { p_id: m.id, p_reason: r.r });
        router.back();
      }, 'Meeting cancelled – invitees told');
  };
  const decideLeave = async (e: Leave, approve: boolean) => {
    const r = await dialog.prompt({
      title: `${approve ? 'Approve' : 'Refuse'} leave – ${people[e.sales_person_id]?.full_name ?? ''}`,
      message: e.reason,
      fields: [{ key: 'n', label: approve ? 'Note' : 'Reason', type: 'multiline', required: !approve }],
    });
    if (r) await run('decide_meeting_exception', { p_id: e.id, p_approve: approve, p_note: r.n || null }, approve ? 'Leave approved' : 'Leave refused');
  };
  const downloadMinutes = () =>
    dialog.run(async () => {
      const { data: logo } = await supabase.from('settings').select('value').eq('key', 'report_logo_url').maybeSingle();
      const name = (pid: string | null) => (pid ? (people[pid]?.full_name ?? '—') : '—');
      const roleOf = (pid: string | null) => (pid ? (ROLE_LABELS[people[pid]?.role as keyof typeof ROLE_LABELS] ?? '') : '');
      let no = 0;
      const toMin = (a: Action): MinutesAction => ({
        no: ++no,
        action: a.action,
        kind: a.kind,
        status: a.status,
        forWhom: a.sales_person_id ? name(a.sales_person_id) : null,
        owner: name(a.owner_id),
        ownerRole: roleOf(a.owner_id),
        assignee: a.assignee_id ? name(a.assignee_id) : null,
        due_date: a.due_date,
        subject:
          [
            a.projects?.name ?? (a.new_project ? `${a.new_project} (new project)` : null),
            a.organizations?.name ?? (a.new_customer ? `${a.new_customer} (new customer)` : null),
            a.org_units?.name,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        objective: a.objective,
        done_at: a.done_at,
        done_note: a.done_note,
      });
      const est = m.team === 'estimation';
      const packPeople = (pack?.people ?? []) as unknown as ({ id: string; name: string } & Record<string, unknown>)[];
      const team = !pack
        ? { facts: [], lists: [] }
        : isProject
          ? projectFacts(pack as unknown as ProjectPack)
          : m.team === 'sales'
          ? salesTeam(pack.team)
          : m.team === 'execution'
            ? execTeam(pack.team as Record<string, unknown>)
            : teamTeam(est, pack.team as Record<string, unknown>);
      const general = actionsFor(null).map(toMin);
      const inPack = new Set(packPeople.map((p) => p.id));
      const others = [...new Set(data.actions.map((a) => a.sales_person_id).filter((x): x is string => !!x && !inPack.has(x)))];
      const noteOf = (pid: string) => data.notes.find((n) => n.sales_person_id === pid)?.note ?? '';
      const persons = [
        ...packPeople.map((p) => {
          const f = m.team === 'sales' || isProject ? salesPerson(p) : m.team === 'execution' ? execPerson(p) : teamPerson(est, p);
          const ex = p.exception as { status: string; reason: string } | null;
          return {
            name: p.name,
            leave: ex ? `Leave from the meeting ${ex.status}: ${ex.reason}` : null,
            facts: f.facts,
            lists: f.lists,
            note: noteOf(p.id),
            actions: actionsFor(p.id).map(toMin),
          };
        }),
        ...others.map((pid) => ({ name: name(pid), leave: null, facts: [], lists: [], note: noteOf(pid), actions: actionsFor(pid).map(toMin) })),
      ];
      const invited = data.invitees.filter((x) => x.status !== 'pending_approval');
      const html = minutesHtml({
        title: label,
        date: m.meeting_date,
        time: `${hhmm(m.starts_at)} – ${hhmm(m.ends_at)}`,
        host: cfg.host,
        startedAt: m.started_at,
        publishedAt: m.published_at,
        figuresAt: pack?.generated_at ?? null,
        period: pack ? `${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}` : null,
        attendance: invited
          .map((x) => ({
            name: name(x.person_id),
            role: roleOf(x.person_id),
            status: x.status === 'invited' ? 'Not marked' : ATT[x.status].label,
            at: x.checkin_at,
            note: x.note,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        reviewTitle: isProject ? 'Project review' : undefined,
        teamHtml: isProject && pack ? timelineHtml(pack as unknown as ProjectPack) : undefined,
        teamFacts: team.facts,
        teamLists: team.lists,
        notes: [m.agenda ? `Agenda: ${m.agenda}` : null, m.notes].filter(Boolean).join('\n\n') || null,
        general,
        people: persons,
        distribution: [m.team === 'sales' ? 'GM / DGM' : 'GM / DGM, SM Projects', ...invited.map((x) => name(x.person_id)).sort()],
        generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
        logoUrl: (logo?.value as string | undefined) ?? null,
      });
      await printHtml(html, { key: `meeting_minutes_${m.team}`, filters: `${label} ${m.meeting_date}`, title: `Minutes – ${label} ${fmtDate(m.meeting_date)}` });
    });
  const actionsFor = (personId: string | null) => data.actions.filter((a) => a.sales_person_id === personId);
  const actionList = (personId: string | null) => (
    <View style={{ gap: 4, marginTop: 6 }}>
      {actionsFor(personId).map((a) => (
        <Row key={a.id} wrap gap={6} style={{ alignItems: 'center' }}>
          <Pill label={a.status === 'done' ? 'Done' : 'Open'} tone={a.status === 'done' ? colors.green : colors.amber} />
          {a.kind !== 'task' ? <Pill label={kindLabel(a.kind)} tone={colors.blue} /> : null}
          <Text style={{ color: colors.ink, flexShrink: 1 }}>
            {a.action} · {people[a.owner_id]?.full_name ?? '—'}
            {isTeamKind(a.kind) ? (a.assignee_id ? ` → ${people[a.assignee_id]?.full_name ?? ''}` : ' (to appoint)') : ''}
            {a.due_date ? ` · by ${fmtDate(a.due_date)}` : ''}
            {a.projects?.name || a.new_project ? ` · ${a.projects?.name ?? `${a.new_project} (new)`}` : ''}
            {a.organizations?.name || a.new_customer ? ` · ${a.organizations?.name ?? `${a.new_customer} (new)`}` : ''}
            {a.status === 'done' && a.done_note ? ` · ${a.done_note}` : ''}
          </Text>
          {host ? (
            <Button small variant="ghost" title={a.status === 'done' ? 'Re-open' : 'Mark done'} onPress={() => run('set_meeting_action_done', { p_id: a.id, p_done: a.status !== 'done' }, 'Updated')} />
          ) : null}
          {edit ? <Button small variant="ghost" title="Delete" onPress={() => run('delete_meeting_action', { p_id: a.id }, 'Deleted')} /> : null}
        </Row>
      ))}
      {edit && adding === (personId ?? 'general') ? (
        <MeetingActionForm
          owners={owners}
          defaultOwner={personId}
          fixedProject={
            isProject && data.project
              ? {
                  project_id: data.project.project_id,
                  organization_id: data.prj?.organization_id ?? null,
                  project: `${projectNo(data.project)} ${data.project.name}`,
                  customer: data.prj?.organizations?.name ?? data.project.client_name,
                }
              : undefined
          }
          onSave={(a) => saveAction(personId, a)}
          onCancel={() => setAdding(null)}
        />
      ) : edit ? (
        <Row>
          <Button small variant="secondary" title="+ Action" onPress={() => setAdding(personId ?? 'general')} />
        </Row>
      ) : null}
    </View>
  );

  const generalCard = (
    <Card style={{ marginTop: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Meeting notes</Text>
        {edit ? <Button small variant="ghost" title="Edit" onPress={() => editNote(null, m.notes ?? '')} /> : null}
      </Row>
      <Muted>{m.notes ?? 'No notes'}</Muted>
      {actionList(null)}
    </Card>
  );

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: `${isProject ? 'Project meeting' : cfg.label} · ${fmtDate(m.meeting_date)}` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
            {`${label} · ${new Date(`${m.meeting_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })} ${fmtDate(m.meeting_date)} · ${hhmm(m.starts_at)} – ${hhmm(m.ends_at)}`}
          </Text>
          <Pill label={m.status === 'published' ? 'Published' : 'Draft'} tone={m.status === 'published' ? colors.green : colors.amber} solid />
        </Row>
        <Muted>
          {pack ? `Figures as at ${fmtDateTime(pack.generated_at)} · last week ${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}` : 'Not generated yet'}
          {m.published_at ? ` · published ${fmtDateTime(m.published_at)}` : ''}
        </Muted>
        {isProject && m.agenda ? <Text style={{ color: colors.ink, marginTop: 4 }}>{`Agenda: ${m.agenda}`}</Text> : null}
        {edit ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {isProject ? (
              <Button variant={pack ? 'secondary' : 'primary'} title={pack ? 'Regenerate project figures' : 'Generate project figures'} onPress={generateProject} />
            ) : (
              <Button
                variant="secondary"
                title="Regenerate figures"
                onPress={() => run('generate_team_meeting', { p_team: m.team, p_date: m.meeting_date }, 'Figures refreshed – notes and actions kept')}
              />
            )}
            <Button
              title={m.team === 'sales' ? 'Publish to GM / DGM' : 'Publish to GM / DGM and SM Projects'}
              onPress={async () => {
                const who = m.team === 'sales' ? 'GM / DGM' : 'GM / DGM and SM Projects';
                if (await dialog.confirm('Publish the meeting pack?', `${who} are notified and can view it. It can no longer be changed; actions go to their people.`, { confirmLabel: 'Publish' }))
                  await run('publish_sales_meeting', { p_id: m.id }, `Published – ${who} notified`);
              }}
            />
            {isProject && !m.started_at ? <Button variant="ghost" title="Cancel meeting" onPress={cancelMeeting} /> : null}
          </Row>
        ) : null}
        {canDownload ? (
          <Row style={{ marginTop: 8 }}>
            <Button variant="secondary" title="Download minutes (PDF)" onPress={downloadMinutes} />
          </Row>
        ) : null}
        {!host ? <Muted>Read only.</Muted> : null}
      </Card>

      <Section
        title={`Attendance (${data.invitees.filter((x) => x.status === 'present').length} of ${data.invitees.filter((x) => x.status !== 'pending_approval').length} present)`}
        right={
          edit && !m.started_at ? (
            <Row gap={6}>
              <Button
                small
                variant="secondary"
                title={isProject ? 'Date, agenda & invitees' : 'Invitees'}
                onPress={() =>
                  router.push({
                    pathname: '/meeting/invite',
                    params: isProject ? { team: m.team, project: m.exec_project_id ?? '', meeting: m.id } : { team: m.team, date: m.meeting_date },
                  })
                }
              />
              {isToday ? <Button small title="Start meeting here" onPress={startMeeting} /> : null}
            </Row>
          ) : undefined
        }
      >
        <Card>
          {m.started_at ? (
            <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Muted style={{ flexShrink: 1 }}>{`Started ${fmtDateTime(m.started_at)} – invitees marking present more than 200 m from the venue need ${host ? 'your' : `${cfg.host}'s`} approval.${live ? ' Attendance updates by itself.' : ''}`}</Muted>
              <Row gap={6}>
                {mine && isToday && m.status === 'draft' && (mine.status === 'invited' || mine.status === 'location_check') ? (
                  <Button small title="I'm here – mark present" onPress={markPresent} />
                ) : null}
                <Button small variant="ghost" title="↻ Refresh" onPress={() => reload()} />
              </Row>
            </Row>
          ) : (
            <Muted>
              {isToday && host
                ? 'Press “Start meeting here” at the meeting venue – its location is used for everyone’s attendance.'
                : 'Invitees mark their attendance in Meetings once the meeting is started.'}
            </Muted>
          )}
          {data.invitees.length ? (
            data.invitees
              .slice()
              .sort((a, b) => (people[a.person_id]?.full_name ?? '').localeCompare(people[b.person_id]?.full_name ?? ''))
              .map((x) => (
                <Row key={x.person_id} wrap gap={8} style={{ alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6, marginTop: 6 }}>
                  <Text style={{ fontWeight: '600', color: colors.ink, minWidth: 170 }}>{people[x.person_id]?.full_name ?? '—'}</Text>
                  <Muted>{ROLE_LABELS[people[x.person_id]?.role as keyof typeof ROLE_LABELS] ?? ''}</Muted>
                  <Pill label={ATT[x.status].label} tone={ATT[x.status].tone} />
                  {x.checkin_at ? <Muted>{`${fmtDateTime(x.checkin_at)}${x.distance_m != null ? ` · ${Math.round(x.distance_m)} m` : ''}`}</Muted> : null}
                  {x.note ? <Muted>{x.note}</Muted> : null}
                  {host && m.started_at && x.status === 'invited' ? (
                    <Row gap={4}>
                      <Button small variant="secondary" title="Mark present" onPress={() => decideAttendance(x, true)} />
                      <Button small variant="ghost" title="Absent" onPress={() => decideAttendance(x, false)} />
                    </Row>
                  ) : null}
                  {host && x.status === 'location_check' ? (
                    <Row gap={4}>
                      <Button small title="Accept present" onPress={() => decideAttendance(x, true)} />
                      <Button small variant="secondary" title="Absent" onPress={() => decideAttendance(x, false)} />
                    </Row>
                  ) : null}
                </Row>
              ))
          ) : (
            <Muted>Nobody invited yet{edit ? ' – press Invitees' : ''}.</Muted>
          )}
          {data.leave
            .filter((e) => e.status === 'pending' || host)
            .map((e) => (
              <Row key={e.id} wrap gap={8} style={{ alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6, marginTop: 6 }}>
                <Text style={{ fontWeight: '600', color: colors.ink, minWidth: 170 }}>{people[e.sales_person_id]?.full_name ?? '—'}</Text>
                <Pill label={e.status === 'pending' ? 'Leave requested' : e.status === 'approved' ? 'Leave approved' : 'Leave refused'} tone={e.status === 'pending' ? colors.amber : e.status === 'approved' ? colors.blue : colors.red} />
                <Muted>{`${e.reason}${e.decision_note ? ` · ${e.decision_note}` : ''}`}</Muted>
                {host && e.status === 'pending' ? (
                  <Row gap={4}>
                    <Button small title="Approve" onPress={() => decideLeave(e, true)} />
                    <Button small variant="secondary" title="Refuse" onPress={() => decideLeave(e, false)} />
                  </Row>
                ) : null}
              </Row>
            ))}
        </Card>
      </Section>

      {isProject ? (
        pack ? (
          <ProjectPackView pack={pack as unknown as ProjectPack} general={generalCard} />
        ) : (
          <>
            <Notice tone={colors.amber}>{host ? 'Generate the project figures before the meeting – press “Generate project figures”.' : 'The project figures have not been generated yet.'}</Notice>
            {generalCard}
          </>
        )
      ) : pack && m.team !== 'sales' ? (
        <PackView
          team={m.team}
          pack={pack as unknown as TeamPack}
          general={generalCard}
          personFooter={(pid) => {
            const note = data.notes.find((n) => n.sales_person_id === pid)?.note ?? '';
            return (
              <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>Discussion</Text>
                  {edit ? <Button small variant="ghost" title={note ? 'Edit' : 'Add notes'} onPress={() => editNote(pid, note)} /> : null}
                </Row>
                <Muted>{note || 'No notes'}</Muted>
                {actionList(pid)}
              </View>
            );
          }}
        />
      ) : pack ? (
        <>
          <Section title="Team">
            <Card>
              <View style={{ gap: 10 }}>
                {bar('Secured vs budget · year to date', t.secured ?? 0, t.budget_secure ?? 0, pct(t.secured ?? 0, t.budget_secure ?? 0))}
                {bar('Invoiced vs budget · year to date', t.invoiced ?? 0, t.budget_invoice ?? 0, pct(t.invoiced ?? 0, t.budget_invoice ?? 0))}
              </View>
            </Card>
            <Grid min={160}>
              <Stat label={`Wins last week · ${mn(t.wins_value)} Mn`} value={t.wins_n ?? 0} tone={t.wins_n ? 'green' : undefined} />
              <Stat label="Losses last week" value={t.losses_n ?? 0} tone={t.losses_n ? 'red' : undefined} />
              <Stat label="Quotations waiting" value={t.quotes_waiting_n ?? 0} />
              <Stat label="Follow-ups overdue" value={t.followups_overdue_n ?? 0} tone={t.followups_overdue_n ? 'red' : undefined} />
              <Stat label={`Slipped invoices · ${mn(t.slipped)} Mn`} value={t.slipped_n ?? 0} tone={t.slipped_n ? 'red' : undefined} />
              <Stat label="Debtors over 90 days (Mn)" value={mn(t.debtors_90)} tone={t.debtors_90 ? 'amber' : undefined} />
            </Grid>
            <Card style={{ marginTop: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Meeting notes</Text>
                {edit ? <Button small variant="ghost" title="Edit" onPress={() => editNote(null, m.notes ?? '')} /> : null}
              </Row>
              <Muted>{m.notes ?? 'No notes'}</Muted>
              {actionList(null)}
            </Card>
          </Section>

          {pack.people.map((p) => {
            const note = data.notes.find((n) => n.sales_person_id === p.id)?.note ?? '';
            return (
              <Section key={p.id} title={p.name}>
                <Card>
                  {p.exception ? (
                    <Notice tone={p.exception.status === 'approved' ? colors.blue : colors.amber}>
                      {`Leave from the meeting ${p.exception.status}: ${p.exception.reason}`}
                    </Notice>
                  ) : null}
                  <Row wrap gap={16} style={{ alignItems: 'center' }}>
                    <View style={{ alignItems: 'center', minWidth: 90 }}>
                      <Text style={{ fontSize: 26, fontWeight: '800', color: pctTone(p.target.score) }}>{p.target.score.toFixed(2)}</Text>
                      <Muted>Score</Muted>
                    </View>
                    <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
                      {bar('Secured vs budget (YTD)', p.target.secured, p.target.budget_secure, p.target.secured_pct)}
                      {bar('Invoiced vs budget (YTD)', p.target.invoiced, p.target.budget_invoice, p.target.invoiced_pct)}
                    </View>
                  </Row>
                  <Grid min={170}>
                    <KeyValue label="Visits last week" value={`${p.visits.done} done · ${p.visits.completed} of ${p.visits.planned} planned · ${p.visits.missed} missed`} />
                    <KeyValue label="Follow-ups overdue" value={String(p.followups_overdue_n)} />
                    <KeyValue label="Quotations waiting" value={String(p.quotes_waiting_n)} />
                    <KeyValue label="Projects not visited 30 days" value={String(p.not_visited_n)} />
                    <KeyValue label="Invoices slipped" value={`${p.invoices.slipped_n} · ${mn(p.invoices.slipped)} Mn`} />
                    <KeyValue label="Invoices due this month" value={`${mn(p.invoices.due_month)} Mn`} />
                    <KeyValue label="Debtors over 90 days" value={`${p.debtors_90.n} · ${mn(p.debtors_90.lkr)} Mn`} />
                    <KeyValue label="Retentions due (30 days)" value={`${p.retentions_due.n} · ${mn(p.retentions_due.lkr)} Mn`} />
                  </Grid>
                  {p.wins.length ? (
                    <Muted>{`Won: ${p.wins.map((w) => `${w.code} ${w.project} (LKR ${amt(w.value)})`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.losses.length ? <Muted>{`Lost: ${p.losses.map((w) => `${w.code} ${w.project}${w.reason ? ` – ${w.reason}` : ''}`).join(' · ')}`}</Muted> : null}
                  {p.quotes_waiting.length ? (
                    <Muted>{`Quotations waiting: ${p.quotes_waiting.map((q) => `${q.code} ${q.project} ${q.days}d`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.followups_overdue.length ? (
                    <Muted>{`Follow-ups overdue: ${p.followups_overdue.map((f) => `${fmtDate(f.date)} ${f.customer}${f.action ? ` – ${f.action}` : ''}`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.not_visited.length ? (
                    <Muted>{`Not visited 30 days: ${p.not_visited.map((n) => `${n.project}${n.last_visit ? ` (last ${fmtDate(n.last_visit)})` : ' (never)'}`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.open_actions.length ? (
                    <Notice tone={colors.amber}>
                      {`Open actions from earlier meetings: ${p.open_actions.map((a) => `${a.action} (${a.owner}${a.due ? `, by ${fmtDate(a.due)}` : ''})`).join(' · ')}`}
                    </Notice>
                  ) : null}
                  <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>Discussion</Text>
                      {edit ? <Button small variant="ghost" title={note ? 'Edit' : 'Add notes'} onPress={() => editNote(p.id, note)} /> : null}
                    </Row>
                    <Muted>{note || 'No notes'}</Muted>
                    {actionList(p.id)}
                  </View>
                </Card>
              </Section>
            );
          })}
        </>
      ) : (
        <Notice tone={colors.amber}>The pack has not been generated.</Notice>
      )}
    </Screen>
  );
}
