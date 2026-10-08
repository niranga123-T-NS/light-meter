import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { projectNo } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { hhmm, isTeam, ownTeam, TEAMS } from '@/lib/meetings';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type Person = { id: string; full_name: string; role: keyof typeof ROLE_LABELS };

// Order of the groups on the list; GM / DGM and System Admin are never invited
const GROUPS: (keyof typeof ROLE_LABELS)[] = [
  'asm_building',
  'asm_infra',
  'operations_exec',
  'sm_projects',
  'sm_estimation',
  'am_estimation',
  'estimation_exec',
  'design_manager',
  'lighting_designer',
  'lighting_engineer',
  'senior_elec_engineer',
  'assistant_engineer',
];

const isTime = (t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());

/** The host selects who is invited to a meeting (sales: Mondays 08:30 – 12:00; estimation / design: the host sets the time).
 * A project meeting (team=project) is called by the SEE from the project's Meetings tab, with its agenda; its project team is
 * selected first. */
export default function InviteToMeeting() {
  const params = useLocalSearchParams<{ date?: string; team?: string; project?: string; meeting?: string }>();
  const team = isTeam(params.team) ? params.team : 'sales';
  const cfg = TEAMS[team];
  const me = useMe();
  const dialog = useDialog();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [when, setWhen] = useState<{ date: string | null; starts: string | null; ends: string | null }>({ date: params.date ?? null, starts: null, ends: null });
  const [agenda, setAgenda] = useState<string | null>(null);
  const isProject = team === 'project';
  const { data, error } = useLoad(async () => {
    const [p, m, ep, mem] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role').eq('active', true).not('role', 'in', '(gm,sys_admin)').order('full_name'),
      isProject
        ? params.meeting
          ? supabase.from('sales_meetings').select('id, meeting_date, starts_at, ends_at, agenda').eq('id', params.meeting).maybeSingle()
          : Promise.resolve({ data: null })
        : supabase.from('sales_meetings').select('id, meeting_date, starts_at, ends_at, agenda').eq('team', team).eq('meeting_date', params.date ?? '').maybeSingle(),
      isProject ? supabase.from('exec_projects').select('id, code, name, wbs_no').eq('id', params.project ?? '').maybeSingle() : Promise.resolve({ data: null }),
      isProject ? supabase.from('exec_members').select('user_id').eq('exec_project_id', params.project ?? '').eq('active', true) : Promise.resolve({ data: [] }),
    ]);
    const invited = m.data
      ? (((await supabase.from('sales_meeting_invitees').select('person_id').eq('meeting_id', m.data.id)).data ?? []) as { person_id: string }[]).map(
          (x) => x.person_id,
        )
      : [];
    return {
      people: ((p.data ?? []) as Person[]).filter((x) => x.id !== me.id),
      invited,
      starts: m.data ? hhmm(m.data.starts_at) : cfg.starts,
      ends: m.data ? hhmm(m.data.ends_at) : cfg.ends,
      date: (m.data?.meeting_date as string | undefined) ?? null,
      agenda: (m.data?.agenda as string | null | undefined) ?? '',
      project: ep.data as { id: string; code: string | null; name: string; wbs_no: string | null } | null,
      members: ((mem.data ?? []) as { user_id: string }[]).map((x) => x.user_id),
    };
  }, [params.date, team, params.project, params.meeting]);
  if (me.role !== cfg.hostRole)
    return (
      <Screen>
        <Notice>{isProject ? 'Only the Senior Electrical Engineer calls project meetings.' : `Only ${cfg.host} invites the team to the ${cfg.label.toLowerCase()}.`}</Notice>
      </Screen>
    );
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  if (isProject && !data.project) return <Screen><Notice>Project not found.</Notice></Screen>;
  // Until changed: the saved list, or (first time) the team's members – for a project meeting, the project team
  const sel =
    picked ??
    new Set(
      data.invited.length
        ? data.invited
        : isProject
          ? data.people.filter((x) => data.members.includes(x.id)).map((x) => x.id)
          : data.people.filter((x) => cfg.members.includes(x.role)).map((x) => x.id),
    );
  const date = when.date ?? data.date ?? params.date ?? (isProject ? todayISO() : '');
  const ag = agenda ?? data.agenda;
  const title = isProject && data.project ? `Project meeting – ${projectNo(data.project)} ${data.project.name}` : cfg.label;
  const starts = when.starts ?? data.starts;
  const ends = when.ends ?? data.ends;
  const timesOk = cfg.fixed || (isTime(starts) && isTime(ends) && starts.padStart(5, '0') < ends.padStart(5, '0'));
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };
  const outsiders = cfg.fixed ? 0 : data.people.filter((p) => sel.has(p.id) && !data.invited.includes(p.id) && !ownTeam(team).includes(p.role)).length;
  const groups = [...GROUPS, ...[...new Set(data.people.map((p) => p.role))].filter((r) => !GROUPS.includes(r))];
  const team1 = isProject ? data.people.filter((p) => data.members.includes(p.id)) : [];

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: isProject ? (params.meeting ? 'Change project meeting' : 'Call a project meeting') : `Invite – ${cfg.label.toLowerCase()}` }} />
      <Card>
        {cfg.fixed ? (
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{`${cfg.label} · Monday ${fmtDate(date)} · 08:30 – 12:00`}</Text>
        ) : (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{title}</Text>
            <DateField label="Date" required value={date} onChange={(v) => setWhen((w) => ({ ...w, date: v }))} quick={[0, 1, 2, 7]} />
            <Row gap={8} wrap>
              <View style={{ minWidth: 140, flex: 1 }}>
                <Field label="Starts" required value={starts} onChangeText={(v) => setWhen((w) => ({ ...w, starts: v }))} placeholder="08:30" />
              </View>
              <View style={{ minWidth: 140, flex: 1 }}>
                <Field label="Ends" required value={ends} onChangeText={(v) => setWhen((w) => ({ ...w, ends: v }))} placeholder="10:00" />
              </View>
            </Row>
            {!timesOk ? <Notice tone={colors.amber}>Enter the times as HH:MM, ending after the start.</Notice> : null}
            {isProject ? (
              <Field
                label="Agenda"
                multiline
                value={ag}
                onChangeText={setAgenda}
                placeholder="e.g. Progress against the programme, delays and recovery, materials, HSE, next two weeks"
              />
            ) : null}
          </>
        )}
        <Muted>
          {isProject
            ? 'Select who is invited – the project team is selected; anyone else (sales, design, estimation, operations) is invited only after SM Projects approves. Invitees are reminded an hour before and mark attendance at the venue. Generate the project figures on the meeting page before the meeting.'
            : cfg.fixed
            ? 'Select who is invited – anyone except GM / DGM and System Admin. Invite by Sunday 10:00; GM / DGM are told if it is not done by 15:00.'
            : 'Select who is invited – anyone except GM / DGM and System Admin. Your team is invited at once; anyone from outside the team is invited only after SM Projects approves. Invitees are reminded an hour before and mark attendance at the venue.'}
        </Muted>
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          <Button
            title={`Send invitations (${sel.size})`}
            disabled={!sel.size || !date || !timesOk}
            onPress={() =>
              dialog.run(async () => {
                const id = isProject
                  ? await rpc<string>('invite_project_meeting', {
                      p_project: params.project,
                      p_meeting: params.meeting ?? null,
                      p_date: date,
                      p_starts: starts,
                      p_ends: ends,
                      p_people: [...sel],
                      p_agenda: ag || null,
                    })
                  : await rpc<string>('invite_team_meeting', {
                      p_team: team,
                      p_date: date,
                      p_starts: cfg.fixed ? null : starts,
                      p_ends: cfg.fixed ? null : ends,
                      p_people: [...sel],
                    });
                router.replace(`/meeting/${id}`);
              }, outsiders ? `Team invited – ${outsiders} from outside the team sent to SM Projects for approval` : 'Invitations sent')
            }
          />
          <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        </Row>
      </Card>
      {[...(team1.length ? ['__project'] : []), ...groups].map((r) => {
        const list = r === '__project' ? team1 : data.people.filter((p) => p.role === r && !team1.includes(p));
        if (!list.length) return null;
        return (
          <Section
            key={r}
            title={r === '__project' ? 'Project team' : `${ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}${!cfg.fixed && !ownTeam(team).includes(r as keyof typeof ROLE_LABELS) ? ' · needs SM Projects approval' : ''}`}
          >
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {list.map((p) => {
                const on = sel.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => toggle(p.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        borderWidth: 2,
                        borderColor: on ? colors.brand : colors.faint,
                        backgroundColor: on ? colors.brand : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text> : null}
                    </View>
                    <Text style={{ color: colors.ink, fontSize: 15 }}>{p.full_name}</Text>
                  </Pressable>
                );
              })}
            </Card>
          </Section>
        );
      })}
    </Screen>
  );
}
