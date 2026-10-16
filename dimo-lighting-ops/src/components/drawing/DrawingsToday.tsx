import { Text, View } from 'react-native';
import { Button, colors, Muted, Row } from '@/components/ui';
import { kindOf, routeOf, stepLabel } from '@/lib/drawings';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Ev = { item_id: string | null; route_id: string | null; what: string; to_status: string | null; note: string | null; by_id: string | null };

/** What the smart drawings recorded on the project that day, as lines the daily report can take into “Work done”. */
export function DrawingsToday({ exec, date, mine, onAdd }: { exec: string; date: string; mine?: string; onAdd: (text: string) => void }) {
  const { data } = useLoad(async () => {
    const { data: pj } = await supabase.from('exec_projects').select('smart_drawings').eq('id', exec).maybeSingle();
    if (!(pj as { smart_drawings: boolean | null } | null)?.smart_drawings) return null;
    const from = `${date}T00:00:00+05:30`, to = new Date(Date.parse(from) + 864e5).toISOString();
    let q = supabase.from('exec_drawing_events').select('item_id, route_id, what, to_status, note, by_id').eq('exec_project_id', exec).gte('at', from).lt('at', to).limit(2000);
    if (mine) q = q.eq('by_id', mine);
    const { data: ev } = await q;
    const list = (ev ?? []) as Ev[];
    const itemIds = [...new Set(list.map((e) => e.item_id).filter(Boolean))] as string[];
    const routeIds = [...new Set(list.map((e) => e.route_id).filter(Boolean))] as string[];
    const [it, rt] = await Promise.all([
      itemIds.length ? supabase.from('exec_drawing_items').select('id, kind').in('id', itemIds) : Promise.resolve({ data: [] }),
      routeIds.length ? supabase.from('exec_drawing_routes').select('id, kind, label').in('id', routeIds) : Promise.resolve({ data: [] }),
    ]);
    return { list, kinds: Object.fromEntries(((it.data ?? []) as { id: string; kind: string }[]).map((x) => [x.id, x.kind])), routes: (rt.data ?? []) as { id: string; kind: string; label: string | null }[] };
  }, [exec, date, mine]);
  if (!data || !data.list.length) return null;

  // items: "Downlight → 2nd fix: 12"; routes: last stage / laid per route; circuits, issues, photos counted
  const stage = new Map<string, number>();
  for (const e of data.list)
    if (e.what === 'Stage' && e.item_id && e.to_status) {
      const k = data.kinds[e.item_id] ?? '?';
      const key = `${kindOf(k).name} → ${stepLabel(k, e.to_status)}`;
      stage.set(key, (stage.get(key) ?? 0) + 1);
    }
  const routeLines = data.routes
    .map((r) => {
      const last = [...data.list].reverse().find((e) => e.route_id === r.id && e.what === 'Route');
      return last ? `${routeOf(r.kind).name}${r.label ? ` (${r.label})` : ''}: ${last.note ?? last.to_status}` : null;
    })
    .filter(Boolean) as string[];
  const circuits = data.list.filter((e) => e.what.startsWith('Circuit ')).length;
  const pins = data.list.filter((e) => e.what === 'Issue pinned').length;
  const photos = data.list.filter((e) => e.what === 'Photo').length;
  const lines = [
    ...[...stage.entries()].map(([k, n]) => `${n} × ${k}`),
    ...routeLines,
    circuits ? `${circuits} circuit test(s) recorded` : null,
    pins ? `${pins} issue(s) pinned on the drawings` : null,
    photos ? `${photos} photo(s) added` : null,
  ].filter(Boolean) as string[];
  if (!lines.length) return null;
  const text = `From the smart drawings:\n${lines.map((l) => `• ${l}`).join('\n')}`;

  return (
    <View style={{ gap: 4, padding: 10, borderRadius: 8, backgroundColor: '#EEF4FB' }}>
      <Text style={{ fontWeight: '700', color: colors.ink }}>{`Smart drawings – ${mine ? 'your updates' : 'updates'} on this day`}</Text>
      {lines.slice(0, 12).map((l) => (
        <Muted key={l}>{`• ${l}`}</Muted>
      ))}
      {lines.length > 12 ? <Muted>{`… and ${lines.length - 12} more`}</Muted> : null}
      <Row>
        <Button small variant="secondary" title="Add to work done" onPress={() => onAdd(text)} />
      </Row>
    </View>
  );
}
