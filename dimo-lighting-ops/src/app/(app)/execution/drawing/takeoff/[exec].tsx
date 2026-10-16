import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, Loading, Muted, Row, Screen, Section } from '@/components/ui';
import { isCont, kindOf, routeMetres, routeOf, WEIGHT, type DItem, type Drawing, type DRoute, type RiserRun } from '@/lib/drawings';
import { fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Row_ = { key: string; name: string; unit: string; total: number; left: number };

/**
 * Materials take-off from the smart drawings: per type of item and per cable / containment, what the drawings hold and what is
 * still to install (items not yet at 2nd fix, cable not yet laid, containment not yet fixed). The chosen lines go to a new
 * material request as a reference list – each item is still checked against Project returns and SAP stock there.
 */
export default function TakeOff() {
  const { exec } = useLocalSearchParams<{ exec: string }>();
  const [floor, setFloor] = useState<string | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const { data, error } = useLoad(async () => {
    const [pj, dw, it, rt, rr, rs] = await Promise.all([
      supabase.from('exec_projects').select('id, code, name').eq('id', exec).maybeSingle(),
      supabase.from('exec_drawings').select('*').eq('exec_project_id', exec).eq('archived', false),
      supabase.from('exec_drawing_items').select('id, drawing_id, kind, status').eq('exec_project_id', exec),
      supabase.from('exec_drawing_routes').select('*').eq('exec_project_id', exec),
      supabase.from('exec_drawing_riser_runs').select('*').eq('exec_project_id', exec),
      supabase.from('exec_drawing_risers').select('id, floor_height_m').eq('exec_project_id', exec),
    ]);
    if (dw.error) throw new Error(dw.error.message);
    return {
      project: pj.data as { code: string | null; name: string } | null,
      drawings: (dw.data ?? []) as Drawing[],
      items: (it.data ?? []) as Pick<DItem, 'id' | 'drawing_id' | 'kind' | 'status'>[],
      routes: (rt.data ?? []) as DRoute[],
      runs: (rr.data ?? []) as RiserRun[],
      risers: (rs.data ?? []) as { id: string; floor_height_m: number }[],
    };
  }, [exec]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const floors = [...new Set(data.drawings.map((d) => d.floor ?? 'Other sheets'))];
  const sheets = data.drawings.filter((d) => !floor || (d.floor ?? 'Other sheets') === floor);
  const ids = new Set(sheets.map((d) => d.id));
  const rows = new Map<string, Row_>();
  const add = (key: string, name: string, unit: string, total: number, left: number) => {
    const r = rows.get(key) ?? { key, name, unit, total: 0, left: 0 };
    r.total += total;
    r.left += left;
    rows.set(key, r);
  };
  for (const it of data.items) {
    if (!ids.has(it.drawing_id) || it.kind === 'riser') continue;
    add(`i:${it.kind}`, kindOf(it.kind).name, 'nos', 1, (WEIGHT[it.status] ?? 0) < 0.75 ? 1 : 0);
  }
  let noScale = 0;
  for (const r of data.routes) {
    const d = sheets.find((x) => x.id === r.drawing_id);
    if (!d) continue;
    const m = routeMetres(d, r);
    if (m == null) {
      noScale += 1;
      continue;
    }
    const cont = isCont(r.kind), len = cont ? m : m * (r.cores ?? 1);
    add(`r:${r.kind}`, routeOf(r.kind).name, 'm', len, cont ? (r.status === 'planned' ? len : 0) : (len * (100 - (r.laid ?? 0))) / 100);
  }
  if (!floor)
    for (const r of data.runs) {
      const h = Number(data.risers.find((x) => x.id === r.riser_id)?.floor_height_m ?? 0), cont = isCont(r.kind);
      const len = Math.abs(Number(r.to_level) - Number(r.from_level)) * h * (cont ? 1 : (r.cores ?? 1));
      add(`r:${r.kind}`, routeOf(r.kind).name, 'm', len, cont ? (r.status === 'planned' ? len : 0) : (len * (100 - (r.laid ?? 0))) / 100);
    }
  const list = [...rows.values()].sort((a, b) => (a.unit === b.unit ? a.name.localeCompare(b.name) : a.unit === 'nos' ? -1 : 1));
  const chosen = list.filter((r) => pick.includes(r.key) && r.left > 0);
  const qty = (r: Row_) => (r.unit === 'm' ? Math.ceil(r.left * 1.05) : r.left); // 5 % on cable and containment for bends and waste

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: 'Materials take-off' }} />
      <TestingBanner what="Smart drawings" show />
      <Card style={{ gap: 6 }}>
        <Muted>{data.project ? `${data.project.code ?? ''} ${data.project.name}` : ''}</Muted>
        <Muted>
          What the drawings still need: items not yet at 2nd fix, cable not yet laid and containment not yet fixed. Cable and containment get 5 % for bends and
          waste. Choose the lines for a material request – each item is still checked against Project returns and SAP stock on the request.
        </Muted>
        <Row wrap gap={6}>
          <Chip label="All floors" on={!floor} onPress={() => setFloor(null)} />
          {floors.map((f) => (
            <Chip key={f} label={f} on={floor === f} onPress={() => setFloor(f)} />
          ))}
        </Row>
        {noScale ? <Muted style={{ color: colors.amber }}>{`${noScale} route(s) are on drawings without a scale and are not counted – set the scale on those drawings.`}</Muted> : null}
      </Card>
      <Section title={`Take-off${floor ? ` – ${floor}` : ''}`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Text style={{ flex: 3, fontWeight: '700', color: colors.faint, fontSize: 12 }}>ITEM</Text>
            <Text style={{ flex: 1, textAlign: 'right', fontWeight: '700', color: colors.faint, fontSize: 12 }}>ON DRAWINGS</Text>
            <Text style={{ flex: 1, textAlign: 'right', fontWeight: '700', color: colors.faint, fontSize: 12 }}>STILL TO INSTALL</Text>
          </View>
          {list.map((r) => {
            const on = pick.includes(r.key);
            return (
              <Pressable
                key={r.key}
                disabled={r.left <= 0}
                onPress={() => setPick((p) => (p.includes(r.key) ? p.filter((x) => x !== r.key) : [...p, r.key]))}
                style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: on ? '#EEF4FB' : undefined }}
              >
                <Text style={{ flex: 3, color: r.left > 0 ? colors.ink : colors.faint }}>{`${on ? '☑' : r.left > 0 ? '☐' : '✓'}  ${r.name}`}</Text>
                <Text style={{ flex: 1, textAlign: 'right', color: colors.muted }}>{`${fmtNumber(r.total, 0)} ${r.unit}`}</Text>
                <Text style={{ flex: 1, textAlign: 'right', color: r.left > 0 ? colors.ink : colors.faint, fontWeight: '600' }}>{r.left > 0 ? `${fmtNumber(r.left, 0)} ${r.unit}` : 'done'}</Text>
              </Pressable>
            );
          })}
          {!list.length ? <Muted style={{ padding: 12 }}>Nothing on the drawings yet.</Muted> : null}
        </Card>
      </Section>
      <Row wrap gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button small variant="secondary" title="Choose all still needed" onPress={() => setPick(list.filter((r) => r.left > 0).map((r) => r.key))} />
        <Button
          title={`Request materials (${chosen.length})`}
          disabled={!chosen.length}
          onPress={() =>
            router.push({
              pathname: '/execution/material/new',
              params: {
                project: exec,
                takeoff: JSON.stringify(chosen.map((r) => ({ n: r.name, q: qty(r), u: r.unit }))),
                purpose: `From the smart drawings take-off${floor ? ` – ${floor}` : ''}`,
              },
            })
          }
        />
      </Row>
    </Screen>
  );
}
