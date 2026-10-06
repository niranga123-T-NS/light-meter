import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section, Select, useWide } from '@/components/ui';
import { bySection, type ClaimContext, type MeasureItem } from '@/lib/boq';
import { fmtNumber, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Mos = { on: boolean; qty: string; boq: string | null };

function QtyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType="decimal-pad"
      style={{ width: 96, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'right', color: colors.ink, backgroundColor: colors.card }}
    />
  );
}

/**
 * Monthly progress claim measurement. With an approved contract BOQ the AE enters the quantity done to date per item and
 * the material on site to claim (from the site store); no rates or amounts are shown. Without a BOQ: the % done.
 */
export default function NewClaimScreen() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const dialog = useDialog();
  const wide = useWide();
  const [period, setPeriod] = useState<string | null>(todayISO());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [mos, setMos] = useState<Record<string, Mos>>({});
  const [pct, setPct] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<'all' | 'done'>('all');
  const { data, error } = useLoad(async () => {
    const c = await rpc<ClaimContext>('claim_context', { p_exec: project });
    setQty(Object.fromEntries(c.items.filter((i) => i.last_qty != null).map((i) => [i.id, String(Number(i.last_qty))])));
    setMos(
      Object.fromEntries(
        c.store.map((s) => {
          const last = c.last_mos.find((m) => m.item.toLowerCase() === s.item.toLowerCase());
          return [s.item, { on: false, qty: String(Number(s.balance)), boq: last?.boq_item_id ?? null }];
        }),
      ),
    );
    return c;
  }, [project]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const live = (data.boq?.version ?? 0) > 0;
  const priced = data.items.filter((i) => !i.heading);
  const boqOpts = priced.map((i) => ({ value: i.id, label: `${i.item_no ? `${i.item_no} ` : ''}${i.description}`, hint: i.unit ?? undefined }));
  const changed = (i: MeasureItem) => (qty[i.id] ?? '') !== (i.last_qty == null ? '' : String(Number(i.last_qty)));
  const shown = filter === 'done' ? data.items.filter((i) => i.heading || (qty[i.id] ?? '') !== '') : data.items;

  const submit = async () => {
    if (!period) return dialog.toast('Enter the month of the claim', 'error');
    const picked = Object.entries(mos).filter(([, m]) => m.on);
    if (live) {
      const over = priced.filter((i) => i.qty != null && Number(qty[i.id] || 0) > Number(i.qty));
      if (over.length && !(await dialog.confirm('More than the BOQ quantity', `${over.length} item(s) are measured above the BOQ quantity (re-measurement). Send anyway?`))) return;
      if (picked.some(([, m]) => !m.boq)) return dialog.toast('Choose the BOQ item for each material on site', 'error');
    }
    await dialog.run(async () => {
      const id = await rpc<string>('prepare_ipc', {
        p_exec: project,
        p_period: period,
        p_pct: live ? null : Number(pct),
        p_measurement: note || null,
        p_lines: live ? priced.filter((i) => (qty[i.id] ?? '') !== '').map((i) => ({ boq_item_id: i.id, qty_to_date: Number(qty[i.id]) })) : null,
        p_mos: live ? picked.map(([item, m]) => ({ item, unit: data.store.find((s) => s.item === item)?.unit, qty: Number(m.qty), boq_item_id: m.boq })) : null,
      });
      router.replace(`/execution/claim/${id}`);
    }, 'Sent to the Senior Electrical Engineer');
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Progress claim – measurement' }} />
      <TestingBanner what="Progress claims" />
      <DateField label="Month of the claim" value={period} onChange={setPeriod} required />
      {!live ? (
        <>
          <Notice>{data.boq ? 'The contract BOQ is waiting for SM Projects – enter the % done for now.' : 'No contract BOQ yet – enter the % of the work done to date.'}</Notice>
          <Field label="% of the work done to date" value={pct} onChangeText={setPct} required keyboardType="decimal-pad" />
          <Field label="Measured work (quantities, areas, poles …)" value={note} onChangeText={setNote} multiline required />
        </>
      ) : (
        <>
          <Notice>Enter the quantity done to date (cumulative) for each item. Items you leave unchanged keep last month’s quantity. Amounts are worked out by the Senior Electrical Engineer.</Notice>
          <Row gap={6}>
            <Chip label="All items" on={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label="Measured only" on={filter === 'done'} onPress={() => setFilter('done')} />
          </Row>
          {bySection(shown).map((g) => (
            <Section key={g.section} title={g.section}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {g.items.map((i) =>
                  i.heading ? (
                    <Text key={i.id} style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, fontWeight: '700', color: colors.ink }}>{i.description}</Text>
                  ) : (
                    <View
                      key={i.id}
                      style={{ flexDirection: wide ? 'row' : 'column', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: changed(i) ? '#EFF6FF' : undefined }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: colors.ink }}>{`${i.item_no ? `${i.item_no}  ` : ''}${i.description}`}</Text>
                        <Muted>{`BOQ ${i.qty == null ? '—' : fmtNumber(Number(i.qty), 2)} ${i.unit ?? ''}${i.last_qty != null ? ` · last claim ${fmtNumber(Number(i.last_qty), 2)}` : ''}`}</Muted>
                      </View>
                      <Row gap={6} style={{ alignItems: 'center' }}>
                        <QtyInput value={qty[i.id] ?? ''} onChange={(v) => setQty((q) => ({ ...q, [i.id]: v }))} placeholder="to date" />
                        <Muted>{i.unit ?? ''}</Muted>
                      </Row>
                    </View>
                  ),
                )}
              </Card>
            </Section>
          ))}
          {(data.boq?.mos_pct ?? 0) > 0 ? (
            <Section title="Material on site">
              <Muted>Delivered and acknowledged materials still in the site store (not yet installed). Tick what to claim this month and match it to the BOQ item.</Muted>
              {data.store.length ? (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {data.store.map((s) => {
                    const m = mos[s.item] ?? { on: false, qty: '', boq: null };
                    const set = (x: Partial<Mos>) => setMos((o) => ({ ...o, [s.item]: { ...m, ...x } }));
                    return (
                      <View key={s.item} style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
                        <Row gap={8} wrap style={{ alignItems: 'center' }}>
                          <Chip label={m.on ? '✓ Claim' : 'Claim'} on={m.on} onPress={() => set({ on: !m.on })} />
                          <Text style={{ flex: 1, minWidth: 160, color: colors.ink }}>{s.item}</Text>
                          <Muted>{`${fmtNumber(Number(s.balance), 2)} ${s.unit} on site`}</Muted>
                          {m.on ? <QtyInput value={m.qty} onChange={(v) => set({ qty: v })} /> : null}
                        </Row>
                        {m.on ? <Select label="BOQ item" value={m.boq} options={boqOpts} onChange={(v) => set({ boq: v })} searchable required /> : null}
                      </View>
                    );
                  })}
                </Card>
              ) : (
                <Muted>Nothing in the site store.</Muted>
              )}
            </Section>
          ) : null}
          <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
        </>
      )}
      <Button title="Send to the Senior Electrical Engineer" onPress={submit} />
    </Screen>
  );
}
