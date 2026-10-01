import { Stack } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { brandFields, canAddBrand, isBrandManager, type BrandRow } from '@/lib/brands';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Tab = 'pending' | 'approved' | 'rejected';

/** Brand master list kept by the Design and Estimation teams; managers approve, correct, reject or merge. */
export default function Brands() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const manager = isBrandManager(me.role);
  const [tab, setTab] = useState<Tab>(manager ? 'pending' : 'approved');
  const [q, setQ] = useState('');

  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('brands').select('*').order('name');
    if (e) throw new Error(e.message);
    return rows as BrandRow[];
  });
  const all = data ?? [];
  const s = q.trim().toLowerCase();
  const rows = all.filter((b) => b.status === tab).filter((b) => !s || [b.name, b.manufacturer, b.country].some((v) => v?.toLowerCase().includes(s)));
  const count = (t: Tab) => all.filter((b) => b.status === t).length;

  const add = async () => {
    const r = await dialog.prompt({ title: 'New brand', fields: brandFields() });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('brands').insert({ name: r.name, manufacturer: r.manufacturer || null, country: r.country || null, origin: r.origin, level: r.level });
      if (e) throw new Error(e.message);
      await reload();
    }, manager ? 'Brand added' : 'Brand added – the Design Manager / SM Estimation will review it');
  };

  const edit = async (b: BrandRow, approve = false) => {
    const r = await dialog.prompt({ title: approve ? `Approve ${b.name}` : `Edit ${b.name}`, fields: brandFields(b) });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('brands')
        .update({ name: r.name, manufacturer: r.manufacturer || null, country: r.country || null, origin: r.origin, level: r.level, ...(approve ? { status: 'approved' } : {}) })
        .eq('id', b.id);
      if (e) throw new Error(e.message);
      await reload();
    }, approve ? 'Brand approved' : 'Brand updated – open designs and estimates use the new details');
  };

  const reject = async (b: BrandRow) => {
    const r = await dialog.prompt({ title: `Reject ${b.name}`, fields: [{ key: 'note', label: 'Reason', type: 'multiline', required: true }] });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('brands').update({ status: 'rejected', review_note: r.note }).eq('id', b.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Brand rejected');
  };

  const merge = async (b: BrandRow) => {
    const r = await dialog.prompt({
      title: `Merge ${b.name} into…`,
      fields: [{ key: 'keep', label: 'Keep this brand', type: 'select', required: true, options: all.filter((x) => x.id !== b.id && x.status === 'approved').map((x) => ({ value: String(x.id), label: x.name })) }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('merge_brands', { p_duplicate: b.id, p_keep: Number(r.keep) });
      await reload();
    }, 'Merged – open designs and estimates now use the kept brand');
  };

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Brands' }} />
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: 'To review', badge: count('pending') },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected / merged' },
          ]}
        />
        {canAddBrand(me.role) ? <Button title="+ New brand" onPress={add} /> : null}
      </Row>
      <TextInput value={q} onChangeText={setQ} placeholder="Search brand, manufacturer or country" style={[styles.input, { marginVertical: 8 }]} />
      <Muted>
        {manager
          ? 'Brands added by designers and estimators can be used straight away and wait here for your review. Approve (correcting the details if needed), reject, or merge a duplicate into an existing brand.'
          : 'Can’t find a brand? Add it – you can use it at once and the Design Manager / SM Estimation will review it.'}
      </Muted>
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        {rows.map((b) => (
          <ListRow
            key={b.id}
            title={b.name}
            subtitle={[
              [b.manufacturer, b.country].filter(Boolean).join(' · '),
              b.proposed_by ? `Added by ${people[b.proposed_by]?.full_name ?? '—'} · ${fmtDateTime(b.proposed_at)}` : null,
              b.review_note,
            ]
              .filter(Boolean)
              .join('\n')}
            highlight={b.status === 'pending' ? colors.amber : undefined}
            right={
              <Row gap={4} wrap>
                <Pill label={b.origin} />
                <Pill label={b.level} tone={colors.blue} />
                {manager && b.status === 'pending' ? <Button small title="Approve" onPress={() => edit(b, true)} /> : null}
                {manager && b.status !== 'rejected' ? <Button small variant="secondary" title="Edit" onPress={() => edit(b)} /> : null}
                {manager && b.status !== 'rejected' ? <Button small variant="ghost" title="Merge" onPress={() => merge(b)} /> : null}
                {manager && b.status === 'pending' ? <Button small variant="ghost" title="Reject" onPress={() => reject(b)} /> : null}
              </Row>
            }
          />
        ))}
        {!rows.length ? <Empty title={tab === 'pending' ? 'Nothing to review' : 'No brands here'} /> : null}
      </Card>
    </Screen>
  );
}
