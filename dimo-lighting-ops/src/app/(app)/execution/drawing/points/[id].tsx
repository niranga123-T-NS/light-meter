import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { DRAWING_EDIT_ROLES } from '@/components/exec/DrawingsTab';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DISC, kindOf, LMS_SYSTEMS, readingFlags, STATUS_COLOR, stepLabel, type DItem, type Drawing, type DTest } from '@/lib/drawings';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const UPDATE_ROLES = [...DRAWING_EDIT_ROLES, 'trainee', 'sub_supervisor'];
// chainage for sorting – no reading goes last
const chOf = (x: DItem) => {
  const v = x.readings?.ch;
  return v != null && String(v).trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : Number.POSITIVE_INFINITY;
};
const TEST_COL: Record<string, string> = { planned: '#9AA0A8', tested: STATUS_COLOR.tested, failed: STATUS_COLOR.failed };

function Line({ cells, head, onPress }: { cells: (string | number | null | undefined)[]; head?: boolean; onPress?: () => void }) {
  const inner = (
    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      {cells.map((c, i) => (
        <Text key={i} style={{ flex: i === 1 ? 2 : 1, fontSize: 13, color: head ? colors.faint : colors.ink, fontWeight: head ? '700' : '400' }} numberOfLines={2}>
          {c == null || c === '' ? '—' : String(c)}
        </Text>
      ))}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner;
}

/** A drawing's lighting-control and BMS points, the scenes and cause & effect tests, and the pole / mast schedule. */
export default function PointsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('exec_drawings').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [it, ts] = await Promise.all([
      supabase.from('exec_drawing_items').select('*').eq('drawing_id', id),
      supabase.from('exec_drawing_tests').select('*').eq('drawing_id', id).order('seq'),
    ]);
    return { d: d as Drawing, items: (it.data ?? []) as DItem[], tests: (ts.data ?? []) as DTest[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { d, items, tests } = data;
  const canEdit = DRAWING_EDIT_ROLES.includes(me.role) && !d.archived;
  const canUpdate = UPDATE_ROLES.includes(me.role) && !d.archived;
  const scope = d.scope ?? {};
  const lmsSys = LMS_SYSTEMS[d.lms] ?? LMS_SYSTEMS.KNX;
  const tag = (x: DItem) => `${kindOf(x.kind).code}${x.label ? ` ${x.label}` : ''}`;
  const run = (fn: () => Promise<unknown>, ok?: string) =>
    dialog.run(async () => {
      await fn();
      await reload();
    }, ok);
  const open = (x: DItem) => router.push(`/execution/drawing/${d.id}?item=${x.id}`);

  const editTest = async (kind: 'scene' | 'cne', t?: DTest) => {
    const pool = items.filter((x) => (kind === 'scene' ? ['lms', 'light'].includes(kindOf(x.kind).d) : ['bms', 'hvac', 'elv'].includes(kindOf(x.kind).d)));
    const v = await dialog.prompt({
      title: kind === 'scene' ? (t ? `Scene – ${t.name}` : 'Add a scene') : t ? `Cause & effect – ${t.name}` : 'Add a cause & effect',
      fields: [
        { key: 'name', label: kind === 'scene' ? 'Scene name (e.g. Lobby – evening)' : 'Name (e.g. Fire alarm zone 3)', required: true, initial: t?.name ?? '' },
        { key: 'area', label: 'Area', initial: t?.area ?? '' },
        { key: 'cause', label: kind === 'scene' ? 'Recalled by (button, timer, sensor)' : 'Cause (what happens)', initial: t?.cause ?? '' },
        { key: 'effect', label: kind === 'scene' ? 'What it does (e.g. downlights 70 %, wall-washers 40 %)' : 'Effect expected (e.g. AHU-1 stops, dampers close)', type: 'multiline', initial: t?.effect ?? '' },
        { key: 'items', label: 'Items in it', type: 'multiselect', initial: (t?.items ?? []).join(','), options: pool.map((x) => ({ value: x.id, label: `${tag(x)}${x.area ? ` · ${x.area}` : ''}` })) },
      ],
    });
    if (!v) return;
    const p = { name: v.name, area: v.area, cause: v.cause, effect: v.effect, items: (v.items ?? '').split(',').filter(Boolean) };
    await run(() => rpc('drawing_test_save', { p: t ? { id: t.id, ...p } : { drawing_id: d.id, kind, ...p } }), 'Saved');
  };

  const result = async (t: DTest) => {
    const v = await dialog.prompt({
      title: `Result – ${t.name}`,
      message: [t.cause ? `${t.kind === 'scene' ? 'Recalled by' : 'Cause'}: ${t.cause}` : null, t.effect ? `${t.kind === 'scene' ? 'Does' : 'Expected'}: ${t.effect}` : null].filter(Boolean).join('\n') || undefined,
      fields: [
        { key: 'st', label: 'Result', type: 'select', required: true, initial: t.status === 'planned' ? 'tested' : t.status, options: [{ value: 'tested', label: 'Works as expected' }, { value: 'failed', label: 'Did not work' }, { value: 'planned', label: 'Not tested yet' }] },
        { key: 'note', label: 'What did not work', type: 'multiline', required: true, when: { key: 'st', in: ['failed'] } },
        { key: 'w', label: 'Witnessed by (client / consultant)', initial: t.witness ?? '' },
      ],
    });
    if (v) await run(() => rpc('drawing_test_result', { p_id: t.id, p_status: v.st, p_note: v.st === 'failed' ? v.note : null, p_witness: v.w }), 'Result recorded');
  };

  const testList = (kind: 'scene' | 'cne') => {
    const list = tests.filter((t) => t.kind === kind);
    return (
      <View style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`${kind === 'scene' ? 'Scenes' : 'Cause & effect'} · ${list.filter((t) => t.status === 'tested').length} of ${list.length} tested`}</Text>
          {canEdit ? <Button small variant="secondary" title={kind === 'scene' ? '+ Scene' : '+ Cause & effect'} onPress={() => editTest(kind)} /> : null}
        </Row>
        {list.length ? (
          list.map((t) => (
            <View key={t.id} style={{ gap: 3, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Row style={{ justifyContent: 'space-between' }} wrap>
                <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${t.name}${t.area ? ` · ${t.area}` : ''}`}</Text>
                <Pill label={t.status === 'tested' ? 'Works' : t.status === 'failed' ? 'Failed' : 'Not tested'} tone={TEST_COL[t.status]} />
              </Row>
              {t.cause ? <Muted>{`${kind === 'scene' ? 'Recalled by' : 'Cause'}: ${t.cause}`}</Muted> : null}
              {t.effect ? <Muted>{`${kind === 'scene' ? 'Does' : 'Effect'}: ${t.effect}`}</Muted> : null}
              {t.items.length ? <Muted>{`Items: ${t.items.map((x) => items.find((i) => i.id === x)).filter(Boolean).map((x) => tag(x!)).join(', ')}`}</Muted> : null}
              {t.tested_at ? <Muted>{`${people[t.tested_by ?? '']?.full_name ?? ''} · ${fmtDateTime(t.tested_at)}${t.witness ? ` · witness ${t.witness}` : ''}${t.result_note ? ` · ${t.result_note}` : ''}`}</Muted> : null}
              <Row gap={6} wrap>
                {canUpdate ? <Chip label="Record result" onPress={() => result(t)} /> : null}
                {canEdit ? <Chip label="Edit" onPress={() => editTest(kind, t)} /> : null}
                {canEdit ? (
                  <Chip
                    label="Remove"
                    onPress={async () => {
                      if (await dialog.confirm(`Remove ${t.name}?`, undefined, { danger: true, confirmLabel: 'Remove' })) await run(() => rpc('drawing_test_delete', { p_id: t.id }), 'Removed');
                    }}
                  />
                ) : null}
              </Row>
            </View>
          ))
        ) : (
          <Muted>None yet.</Muted>
        )}
      </View>
    );
  };

  const lms = items.filter((x) => kindOf(x.kind).d === 'lms'), bms = items.filter((x) => kindOf(x.kind).d === 'bms');
  const out = items
    .filter((x) => kindOf(x.kind).d === 'out')
    .sort((a, b) => chOf(a) - chOf(b) || (a.label ?? '').localeCompare(b.label ?? ''));
  const flagged = out.filter((x) => readingFlags(x).length);
  const done = (list: DItem[]) => list.filter((x) => x.status === 'tested' || x.status === 'done').length;

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: `Points & tests · ${d.sheet_no ?? d.title}` }} />
      <TestingBanner what="Smart drawings" show />
      <Card>
        <Muted>{`${d.sheet_no ? `${d.sheet_no} · ` : ''}${d.title}${d.floor ? ` · ${d.floor}` : ''}${d.revision ? ` rev ${d.revision}` : ''}`}</Muted>
        <Row wrap gap={8} style={{ marginTop: 6 }}>
          <Button small variant="secondary" title="Back to the drawing" onPress={() => router.push(`/execution/drawing/${d.id}`)} />
        </Row>
      </Card>
      {scope.lms ? (
        <Section title={`Lighting control – ${d.lms}`}>
          <Card style={{ gap: 12 }}>
            <View>
              <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{`Points list · ${lms.length} devices · ${done(lms)} tested`}</Text>
              <Line head cells={['Device', 'Name', lmsSys.addr, 'Area', 'Stage']} />
              {lms.map((x) => (
                <Line key={x.id} cells={[kindOf(x.kind).name, x.label, x.circuit, x.area, stepLabel(x.kind, x.status, d.lms)]} />
              ))}
              {!lms.length ? <Muted>No lighting-control devices on this drawing yet.</Muted> : null}
              <Muted style={{ marginTop: 4 }}>{`Keep the ${lmsSys.file} with the project documents.`}</Muted>
            </View>
            {testList('scene')}
          </Card>
        </Section>
      ) : null}
      {scope.bms ? (
        <Section title="BMS">
          <Card style={{ gap: 12 }}>
            <View>
              <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{`Points list · ${bms.length} points · ${done(bms)} commissioned`}</Text>
              <Line head cells={['Device', 'Name', 'Controller / point', 'Area', 'Stage']} />
              {bms.map((x) => (
                <Line key={x.id} cells={[kindOf(x.kind).name, x.label, x.circuit, x.area, stepLabel(x.kind, x.status, d.lms)]} />
              ))}
              {!bms.length ? <Muted>No BMS points on this drawing yet.</Muted> : null}
            </View>
            {testList('cne')}
          </Card>
        </Section>
      ) : null}
      {scope.outdoor ? (
        <Section title={DISC.out.name}>
          <Card style={{ gap: 8 }}>
            {flagged.length ? <Notice tone={colors.red}>{flagged.map((x) => `${tag(x)}: ${readingFlags(x).join('; ')}`).join('\n')}</Notice> : null}
            <Text style={{ fontWeight: '700', color: colors.ink }}>{`Schedule by chainage · ${out.length} · ${done(out)} tested`}</Text>
            <Line head cells={['Chainage', 'Pole / mast', 'Height', 'Cube 28 d / grade', 'Earth Ω', 'Aiming', 'Stage']} />
            {out.map((x) => {
              const r = x.readings ?? {};
              return (
                <Line
                  key={x.id}
                  cells={[r.ch ? `${r.ch} m` : null, tag(x), r.ht ? `${r.ht} m` : null, r.cube28 || r.grade ? `${r.cube28 ?? '—'} / ${r.grade ?? '—'}` : null, r.earth, r.aim || (r.tilt ? `${r.tilt}°` : null), stepLabel(x.kind, x.status)]}
                  onPress={() => open(x)}
                />
              );
            })}
            {!out.length ? <Muted>No poles or masts on this drawing yet – place them with “Item to place”, then record their readings.</Muted> : null}
            <Muted>Readings (chainage, cube, earth, aiming) are recorded on each pole or mast; cubes below the grade and earths above 10 Ω are flagged.</Muted>
          </Card>
        </Section>
      ) : null}
      {!scope.lms && !scope.bms && !scope.outdoor ? <Notice>This drawing has no lighting control, BMS or outdoor scope – change it in the drawing details.</Notice> : null}
    </Screen>
  );
}
