import { Text, View } from 'react-native';
import { Card, colors, Muted, Section } from '@/components/ui';
import { kindOf, routeOf } from '@/lib/drawings';
import { fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Fig = { boq_item_id: string | null; kind: string | null; unit: string; total: number; installed: number; tested: number };

/**
 * Reference only: what the smart drawings show as installed by one installer (DIMO or a subcontractor). It sits beside the
 * measurement sheets and never fills an IPA / IPC – the measured quantities stay the ones that count.
 */
export function InstallerFigures({ exec, installer, subName }: { exec: string; installer: 'dimo' | 'sub'; subName?: string | null }) {
  const { data } = useLoad(async () => {
    const { data: pj } = await supabase.from('exec_projects').select('smart_drawings').eq('id', exec).maybeSingle();
    if (!(pj as { smart_drawings: boolean | null } | null)?.smart_drawings) return null;
    let sub: string | null = null;
    if (installer === 'sub') {
      const { data: s } = await supabase.from('exec_subcontractors').select('id, name').eq('exec_project_id', exec);
      sub = ((s ?? []) as { id: string; name: string }[]).find((x) => x.name.trim().toLowerCase() === (subName ?? '').trim().toLowerCase())?.id ?? null;
      if (!sub) return { figs: [] as Fig[], boq: [] as { id: string; item_no: string | null; description: string }[], noSub: true };
    }
    const figs = await rpc<Fig[]>('drawing_installer_figures', { p_exec: exec, p_installer: installer, p_sub: sub }).catch(() => [] as Fig[]);
    const ids = [...new Set(figs.map((f) => f.boq_item_id).filter(Boolean))] as string[];
    const { data: b } = ids.length ? await supabase.from('exec_boq_items').select('id, item_no, description').in('id', ids) : { data: [] };
    return { figs, boq: (b ?? []) as { id: string; item_no: string | null; description: string }[], noSub: false };
  }, [exec, installer, subName]);
  if (!data) return null;
  const name = (f: Fig) => {
    if (f.boq_item_id) {
      const b = data.boq.find((x) => x.id === f.boq_item_id);
      return b ? `${b.item_no ?? ''} ${b.description}`.trim() : 'BOQ line';
    }
    return f.unit === 'm' ? routeOf(f.kind ?? '').name : kindOf(f.kind ?? '').name;
  };
  const list = [...data.figs].sort((a, b) => Number(!!b.boq_item_id) - Number(!!a.boq_item_id) || name(a).localeCompare(name(b)));
  return (
    <Section title={`Smart drawings – ${installer === 'dimo' ? 'installed by DIMO' : `installed by ${subName ?? 'the subcontractor'}`} (reference)`}>
      <Card style={{ gap: 4 }}>
        <Muted>Reference only – the measurement sheets count. These are the items and routes the engineers marked on the drawings as installed by them.</Muted>
        {data.noSub ? <Muted>This subcontractor is not on the project&apos;s subcontractor list, so nothing on the drawings is tagged to them.</Muted> : null}
        {list.length ? (
          <View>
            <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Text style={{ flex: 3, fontSize: 12, fontWeight: '700', color: colors.faint }}>BOQ LINE / TYPE</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.faint }}>ON DRAWINGS</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.faint }}>INSTALLED</Text>
              <Text style={{ flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.faint }}>TESTED</Text>
            </View>
            {list.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={{ flex: 3, fontSize: 13, color: colors.ink }} numberOfLines={2}>
                  {name(f)}
                </Text>
                <Text style={{ flex: 1, textAlign: 'right', fontSize: 13, color: colors.muted }}>{`${fmtNumber(Number(f.total), 0)} ${f.unit}`}</Text>
                <Text style={{ flex: 1, textAlign: 'right', fontSize: 13, color: colors.ink, fontWeight: '600' }}>{`${fmtNumber(Number(f.installed), 0)} ${f.unit}`}</Text>
                <Text style={{ flex: 1, textAlign: 'right', fontSize: 13, color: colors.muted }}>{`${fmtNumber(Number(f.tested), 0)} ${f.unit}`}</Text>
              </View>
            ))}
          </View>
        ) : !data.noSub ? (
          <Muted>Nothing on the drawings is marked as installed by them yet.</Muted>
        ) : null}
      </Card>
    </Section>
  );
}
