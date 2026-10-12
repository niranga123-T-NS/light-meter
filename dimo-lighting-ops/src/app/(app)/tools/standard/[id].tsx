import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { printHtml } from '@/lib/export';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { STD_COLS, STD_EDITORS, standardSheetHtml, type Standard, type StdGroupRow } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

/** One space in the standards: the values in plain words, notes and source – share a DRAFT recommendation sheet with the client */
export default function StandardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('lighting_standards').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: g } = await supabase.from('lighting_standard_groups').select('*').eq('grp', s.grp).single();
    return { s: s as Standard, g: g as StdGroupRow };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { s, g } = data;
  const cols = STD_COLS[s.grp];
  const editor = STD_EDITORS.includes(me.role);

  const share = () =>
    dialog.run(() =>
      printHtml(standardSheetHtml(s, g, `${me.full_name} – ${ROLE_SHORT[me.role]}`), {
        key: 'standard_sheet',
        filters: `${g.title} · ${s.space}`,
        title: `Recommended lighting – ${s.space}`,
      }),
    );
  const edit = async () => {
    const r = await dialog.prompt({
      title: `Change – ${s.space}`,
      fields: [
        { key: 'category', label: 'Category', required: true, initial: s.category },
        { key: 'space', label: 'Space / task / activity', required: true, initial: s.space },
        ...cols.map((c) => ({ key: c.key, label: `${c.label}${c.unit ? ` (${c.unit})` : ''}`, initial: s.vals?.[c.key] == null ? '' : String(s.vals[c.key]) })),
        { key: 'ref', label: 'Reference in the standard', initial: s.ref ?? '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: s.notes ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const vals = { ...s.vals, ...Object.fromEntries(cols.map((c) => [c.key, r[c.key] === '' || r[c.key] === undefined ? null : c.text ? r[c.key] : Number(r[c.key])])) };
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('lighting_standards')
        .update({ category: r.category.trim(), space: r.space.trim(), vals, ref: r.ref || null, notes: r.notes || null, updated_by: me.id, updated_at: new Date().toISOString() })
        .eq('id', s.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };
  const remove = async () => {
    if (await dialog.confirm('Remove this space?', 'It no longer shows in Sales Tools. The change is logged.', { danger: true, confirmLabel: 'Remove' }))
      await dialog.run(async () => {
        const { error: e } = await supabase.from('lighting_standards').update({ active: false, updated_by: me.id, updated_at: new Date().toISOString() }).eq('id', s.id);
        if (e) throw new Error(e.message);
        router.back();
      }, 'Removed');
  };

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: s.space }} />
      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{s.space}</Text>
        <Muted>{`${g.title} · ${s.category} · ${g.source}${s.ref ? ` · ${s.ref}` : ''}`}</Muted>
        {g.reviewed_at ? null : <Notice tone={colors.amber}>Awaiting Design Manager review.</Notice>}
        {cols.map((c) => {
          const v = s.vals?.[c.key];
          const has = v !== null && v !== undefined && v !== '';
          return (
            <View key={c.key} style={{ flexDirection: 'row', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line, alignItems: 'center' }}>
              <Text style={{ width: 70, fontWeight: '700', color: colors.ink }}>{c.label}</Text>
              <Text style={{ width: 110, fontSize: 18, fontWeight: '700', color: has ? colors.brand : colors.muted }}>{has ? `${v}${c.unit ? ` ${c.unit}` : ''}` : '—'}</Text>
              <Text style={{ flex: 1, color: colors.ink }}>{has && c.explain ? c.explain(String(v)) : has ? '' : 'Not set'}</Text>
            </View>
          );
        })}
        {s.notes ? <Notice tone={colors.blue}>{s.notes}</Notice> : null}
        {s.updated_by ? <Muted>{`Last changed by ${people[s.updated_by]?.full_name ?? ''} · ${fmtDateTime(s.updated_at)}`}</Muted> : null}
        {g.reviewed_at ? <Muted>{`Group reviewed on ${fmtDate(g.reviewed_at)}`}</Muted> : null}
        <Row wrap gap={8} style={{ marginTop: 6 }}>
          <Button title="Share with the client (DRAFT)" onPress={share} />
          {editor ? <Button variant="secondary" title="Change" onPress={edit} /> : null}
          {editor ? <Button variant="ghost" title="Remove" onPress={remove} /> : null}
        </Row>
        <Muted>The shared sheet is marked “DRAFT – for discussion only” and names the standard and edition. Final design by DIMO Lighting Design.</Muted>
      </Card>
    </Screen>
  );
}
