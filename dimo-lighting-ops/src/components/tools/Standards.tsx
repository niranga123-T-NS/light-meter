import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { SportCards } from '@/components/tools/SportCards';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { cached, useLoad, usePeople } from '@/lib/hooks';
import { STD_COLS, STD_EDITORS, stdVal, type Standard, type StdGroup, type StdGroupRow } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

/** Standards: recommended lighting by space, grouped by standard – kept on the phone for use without signal */
export function Standards({ search }: { search: string }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [grp, setGrp] = useState<StdGroup>('indoor');
  const [cat, setCat] = useState<string>('all');
  const editor = STD_EDITORS.includes(me.role);
  const { data, error, reload } = useLoad(
    () =>
      cached('lighting_standards', async () => {
        const [g, s] = await Promise.all([
          supabase.from('lighting_standard_groups').select('*').order('sort'),
          supabase.from('lighting_standards').select('*').eq('active', true).order('sort'),
        ]);
        if (g.error) throw new Error(g.error.message);
        if (s.error) throw new Error(s.error.message);
        return { groups: (g.data ?? []) as StdGroupRow[], rows: (s.data ?? []) as Standard[] };
      }),
    [],
  );
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const q = search.trim().toLowerCase();
  const g = data.groups.find((x) => x.grp === grp);
  // A search looks across all the groups; otherwise the chosen group and category
  const rows = data.rows.filter((r) => (q ? `${r.space} ${r.category} ${r.notes ?? ''}`.toLowerCase().includes(q) : r.grp === grp && (cat === 'all' || r.category === cat)));
  const cats = [...new Set(data.rows.filter((r) => r.grp === grp).map((r) => r.category))];
  const cols = STD_COLS[grp];

  const addSpace = async () => {
    const r = await dialog.prompt({
      title: `Add a space – ${g?.title ?? ''}`,
      fields: [
        { key: 'category', label: 'Category', required: true, initial: cat !== 'all' ? cat : cats[0] ?? '' },
        { key: 'space', label: 'Space / task / activity', required: true },
        ...cols.map((c) => ({ key: c.key, label: `${c.label}${c.unit ? ` (${c.unit})` : ''}` })),
        { key: 'ref', label: 'Reference in the standard (optional)', hint: 'e.g. Table 7.4, ref 5.26.1' },
        { key: 'notes', label: 'Notes', type: 'multiline' },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    const vals = Object.fromEntries(cols.map((c) => [c.key, r[c.key] === '' || r[c.key] === undefined ? null : c.text ? r[c.key] : Number(r[c.key])]));
    await dialog.run(async () => {
      const { error: e } = await supabase.from('lighting_standards').insert({
        grp,
        category: r.category.trim(),
        space: r.space.trim(),
        ref: r.ref || null,
        notes: r.notes || null,
        vals,
        sort: Math.max(0, ...data.rows.map((x) => x.sort)) + 1,
        updated_by: me.id,
      });
      if (e) throw new Error(e.message);
      await reload();
    }, 'Added');
  };
  const markReviewed = async () => {
    if (!g) return;
    const r = await dialog.prompt({
      title: `Mark ${g.title} as reviewed`,
      message: 'Confirms the values in this group match the standard. Sales see the date of your review.',
      fields: [
        { key: 's', label: 'Standard and edition', required: true, initial: g.source },
        { key: 'n', label: 'Note (optional)', type: 'multiline', initial: g.note ?? '' },
      ],
      confirmLabel: 'Mark reviewed',
    });
    if (r)
      await dialog.run(async () => {
        const { error: e } = await supabase.from('lighting_standard_groups').update({ source: r.s.trim(), note: r.n || null, reviewed_at: new Date().toISOString(), reviewed_by: me.id }).eq('grp', g.grp);
        if (e) throw new Error(e.message);
        await reload();
      }, 'Marked as reviewed');
  };

  return (
    <>
      {!q ? (
        <Segmented
          value={grp}
          onChange={(v) => {
            setGrp(v);
            setCat('all');
          }}
          options={data.groups.map((x) => ({ value: x.grp, label: x.title }))}
        />
      ) : (
        <Muted>{`Search in all standards: ${rows.length} found`}</Muted>
      )}
      {!q && g ? (
        <Card style={{ gap: 4 }}>
          <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{g.source}</Text>
            {editor ? (
              <Row gap={6}>
                <Button small variant="secondary" title="+ Space" onPress={addSpace} />
                <Button small variant="ghost" title="Mark reviewed" onPress={markReviewed} />
              </Row>
            ) : null}
          </Row>
          {g.reviewed_at ? (
            <Muted>{`Reviewed by ${people[g.reviewed_by ?? '']?.full_name ?? 'the Design Manager'} on ${fmtDate(g.reviewed_at)}${g.note ? ` · ${g.note}` : ''}`}</Muted>
          ) : (
            <Notice tone={colors.amber}>Awaiting Design Manager review – check the values against the standard before relying on them.</Notice>
          )}
          {cats.length > 1 && grp !== 'sports' ? (
            <Segmented value={cat} onChange={setCat} options={[{ value: 'all', label: 'All' }, ...cats.map((c) => ({ value: c, label: c }))]} />
          ) : null}
        </Card>
      ) : null}
      {!q && grp === 'sports' ? (
        <SportCards rows={rows} />
      ) : (
      <DataTable
        rows={rows}
        keyOf={(r) => r.id}
        onPress={(r) => router.push(`/tools/standard/${r.id}`)}
        emptyTitle={q ? 'Nothing found' : 'No spaces in this group yet'}
        columns={[
          { h: 'Space', w: 280, grow: true, v: (r) => (q ? `${r.space}\n${data.groups.find((x) => x.grp === r.grp)?.title ?? ''} · ${r.category}` : cat === 'all' ? `${r.space}\n${r.category}` : r.space) },
          ...(q ? [] : cols).map((c) => ({ h: c.unit ? `${c.label} ${c.unit}` : c.label, w: c.text ? 110 : 76, right: !c.text, v: (r: Standard) => stdVal(r, c) })),
        ]}
      />
      )}
      <Muted>Tap a space for what the values mean and to share a recommendation sheet with the client (marked DRAFT).</Muted>
    </>
  );
}
