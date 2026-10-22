import { useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { AcademyLeaders, AcademyProfile } from '@/components/tools/AcademyMe';
import { Body, Button, Card, ErrorBanner, Loading, Muted, Pill, Row, Segmented, colors } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import { type AcademyBadgeDef, type AcademyFlag, type AcademyMe, type AcademyTeamRow, FLAG_LABELS, STATUS_COLOURS, STATUS_LABELS, courseLabel } from '@/lib/academy';

/** One team member: their Dacademy page with the coach's actions – spot check, award a badge, set the plan dates */
function Person({ id, onChange }: { id: string; onChange: () => void }) {
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => rpc<AcademyMe>('academy_me', { p_user: id }), [id]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const done = () => {
    reload();
    onChange();
  };
  const spot = async () => {
    const r = await dialog.prompt({
      title: `Spot check – ${data.full_name}`,
      message: 'Ask two or three questions on a lesson they passed, or watch them do the task on a real job.',
      fields: [
        { key: 'topic', label: 'Topic', required: true, maxLength: 200 },
        { key: 'result', label: 'Result', type: 'select', required: true, options: [{ value: 'pass', label: 'Pass' }, { value: 'needs_work', label: 'Needs work' }] },
        { key: 'note', label: 'Note', type: 'multiline', maxLength: 1000 },
      ],
      confirmLabel: 'Save',
    });
    if (r && (await dialog.run(() => rpc('academy_spotcheck_add', { p_user: id, p_topic: r.topic, p_result: r.result, p_note: r.note }), 'Spot check saved'))) done();
  };
  const award = async () => {
    const { data: defs } = await supabase.from('academy_badge_defs').select('*').eq('auto', false).order('sort');
    const r = await dialog.prompt({
      title: `Award a badge – ${data.full_name}`,
      fields: [
        { key: 'badge', label: 'Badge', type: 'select', required: true, options: ((defs ?? []) as AcademyBadgeDef[]).map((d) => ({ value: d.key, label: `${d.icon} ${d.name} (+${d.points} pts)`, hint: d.rule })) },
        { key: 'note', label: 'What for', type: 'multiline', required: true, maxLength: 500 },
      ],
      confirmLabel: 'Award',
    });
    if (r && (await dialog.run(() => rpc('academy_badge_award', { p_user: id, p_badge: r.badge, p_note: r.note }), 'Badge awarded'))) done();
  };
  const plan = async () => {
    const r = await dialog.prompt({
      title: `Plan dates – ${data.full_name}`,
      message: `By default the path starts at the launch and runs ${data.path.months ?? '–'} months. Set other dates for a new joiner or after leave.`,
      fields: [
        { key: 'start', label: 'Start', type: 'date', required: true, initial: data.path.start_on ?? '' },
        { key: 'target', label: 'Target', type: 'date', required: true, initial: data.path.target_on ?? '' },
        { key: 'note', label: 'Reason', type: 'multiline', maxLength: 500 },
      ],
      confirmLabel: 'Save',
    });
    if (r && (await dialog.run(() => rpc('academy_plan_set', { p_user: id, p_start: r.start, p_target: r.target, p_note: r.note }), 'Plan saved'))) done();
  };
  return (
    <View style={{ gap: 8 }}>
      <Row gap={6} wrap>
        <Button small title="Spot check" onPress={spot} />
        <Button small variant="secondary" title="Award a badge" onPress={award} />
        <Button small variant="secondary" title="Plan dates" onPress={plan} />
      </Row>
      {data.path.required.length ? <Muted>{`Path: ${data.path.required.map(courseLabel).join(', ')} · ${fmtDate(data.path.start_on)} → ${fmtDate(data.path.target_on)}${data.path.custom ? ' (set by the coach)' : ''} · ${data.path.pace} a week`}</Muted> : null}
      <AcademyProfile d={data} own={false} />
    </View>
  );
}

/** Review flags: a pass much faster than reading time, many tries, or many passes in a day – a talk, never a penalty */
function Flags({ onChange }: { onChange: () => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(true);
  const { data, error, reload } = useLoad(() => rpc<AcademyFlag[]>('academy_flags_list', { p_open: open }), [open]);
  const review = async (f: AcademyFlag) => {
    const r = await dialog.prompt({ title: `Reviewed – ${f.full_name}`, message: f.detail, fields: [{ key: 'note', label: 'Note (what you found)', type: 'multiline', maxLength: 1000 }], confirmLabel: 'Close the flag' });
    if (r && (await dialog.run(() => rpc('academy_flag_review', { p_id: f.id, p_note: r.note }), 'Flag closed'))) {
      reload();
      onChange();
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Muted>A flag is a prompt for a short spot check, never a penalty. Close it with what you found.</Muted>
      <Segmented value={open ? 'open' : 'all'} onChange={(v) => setOpen(v === 'open')} options={[{ value: 'open', label: 'To review' }, { value: 'all', label: 'All' }]} />
      {!data ? (error ? <ErrorBanner message={error} /> : <Loading />) : (
        <DataTable
          rows={data}
          keyOf={(r) => r.id}
          onPress={(r) => (r.reviewed_at ? undefined : review(r))}
          emptyTitle="Nothing to review"
          columns={[
            { h: 'Name', w: 170, v: (r) => r.full_name },
            { h: 'Flag', w: 120, v: (r) => <Pill label={FLAG_LABELS[r.kind]} tone={colors.amber} /> },
            { h: 'Detail', w: 260, grow: true, v: (r) => r.detail },
            { h: 'When', w: 100, v: (r) => fmtDate(r.created_at) },
            { h: 'Review', w: 180, v: (r) => (r.reviewed_at ? `${r.reviewed_by ?? ''} ${fmtDate(r.reviewed_at)}${r.note ? `\n${r.note}` : ''}` : 'Tap to close') },
          ]}
        />
      )}
    </View>
  );
}

/** Dacademy team view: everyone the viewer coaches (trainers: all; Design Manager: design; SM Estimation: estimation) */
export function AcademyTeam() {
  const [tab, setTab] = useState<'team' | 'flags' | 'top'>('team');
  const [sel, setSel] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => rpc<AcademyTeamRow[]>('academy_team_view'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const flags = data.reduce((t, r) => t + r.flags_open, 0);
  const cur = data.find((r) => r.user_id === sel);
  const count = (s: string) => data.filter((r) => r.state.status === s).length;
  return (
    <View style={{ gap: 8 }}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'team', label: 'Team' }, { value: 'flags', label: 'Please review', badge: flags }, { value: 'top', label: 'Top learners' }]} />
      {tab === 'flags' ? (
        <Flags onChange={reload} />
      ) : tab === 'top' ? (
        <AcademyLeaders />
      ) : (
        <>
          <Row gap={6} wrap>
            {(['ahead', 'on_track', 'behind', 'idle', 'complete'] as const).map((s) => (count(s) ? <Pill key={s} label={`${STATUS_LABELS[s]} ${count(s)}`} tone={STATUS_COLOURS[s]} /> : null))}
          </Row>
          <DataTable
            rows={data}
            keyOf={(r) => r.user_id}
            onPress={(r) => setSel(r.user_id === sel ? null : r.user_id)}
            rowStyle={(r) => (r.user_id === sel ? { backgroundColor: '#eef4fb' } : undefined)}
            emptyTitle="Nobody yet"
            columns={[
              { h: 'Name', w: 190, grow: true, v: (r) => `${r.full_name}\n${ROLE_LABELS[r.role] ?? r.role}` },
              { h: 'Status', w: 100, v: (r) => <Pill label={STATUS_LABELS[r.state.status]} tone={STATUS_COLOURS[r.state.status]} /> },
              { h: 'Path', w: 110, right: true, v: (r) => (r.state.items ? `${r.state.done} / ${r.state.items}\n${Math.round((100 * r.state.done) / r.state.items)}%` : '—') },
              { h: 'This week', w: 90, right: true, v: (r) => (r.state.pace ? `${r.state.this_week} / ${r.state.pace}` : String(r.state.this_week)), tone: (r) => (r.state.pace && r.state.this_week >= r.state.pace ? colors.green : undefined) },
              { h: 'Points', w: 90, right: true, v: (r) => `${r.points}\n+${r.month_points} mo` },
              { h: 'Tests', w: 60, right: true, v: (r) => String(r.tests_passed) },
              { h: 'Badges', w: 70, right: true, v: (r) => String(r.badges) },
              { h: 'Flags', w: 60, right: true, v: (r) => (r.flags_open ? String(r.flags_open) : '—'), tone: (r) => (r.flags_open ? colors.amber : undefined) },
              { h: 'Last active', w: 100, v: (r) => (r.state.last_at ? fmtDate(r.state.last_at) : '—') },
              { h: 'Spot check', w: 100, v: (r) => (r.last_spotcheck ? fmtDate(r.last_spotcheck) : '—') },
            ]}
          />
          {cur ? (
            <Card style={{ gap: 6 }}>
              <Body style={{ fontWeight: '700' }}>{cur.full_name}</Body>
              <Person id={cur.user_id} onChange={reload} />
            </Card>
          ) : (
            <Muted>Tap a person to see their courses and badges, do a spot check, award a badge or change their plan dates.</Muted>
          )}
        </>
      )}
    </View>
  );
}
