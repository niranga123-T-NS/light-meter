import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Loading, Muted, Notice, Row, Screen, Section, Segmented } from '@/components/ui';
import type { Variation } from '@/lib/execution';
import { fmtMoney, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Line = { description: string; unit: string; qty: string; rate: string; amount: string };
const blank = (): Line => ({ description: '', unit: '', qty: '', rate: '', amount: '' });
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
const lineValue = (l: Line) => {
  const q = num(l.qty);
  const r = num(l.rate);
  return q != null && r != null ? q * r : (num(l.amount) ?? 0);
};

/**
 * A variation approved by the client / consultant goes into the BOQ as its own section (measured separately by the AE):
 *  ?project=…   the SEE adds a variation approved outside the app (non-BOQ items with description and amounts)
 *  ?variation=… the client's approval of a variation raised in the app – the value may be adjusted by them
 */
export default function AcceptVariationScreen() {
  const { project, variation } = useLocalSearchParams<{ project?: string; variation?: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [vo, setVo] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [month, setMonth] = useState<string | null>(todayISO());
  const [vtype, setVtype] = useState<'addition' | 'omission'>('addition');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [note, setNote] = useState('');
  const { data: v } = useLoad(async () => {
    if (!variation) return null;
    const { data } = await supabase.from('variations').select('*').eq('id', variation).single();
    const x = data as Variation;
    setLines([{ description: x.title, unit: 'sum', qty: '', rate: '', amount: x.value_lkr != null ? String(Math.abs(Number(x.value_lkr))) : '' }]);
    return x;
  }, [variation]);
  if (variation && !v) return <Screen><Loading /></Screen>;
  const total = lines.reduce((s, l) => s + lineValue(l), 0);
  const setLine = (i: number, x: Partial<Line>) => setLines((s) => s.map((l, k) => (k === i ? { ...l, ...x } : l)));

  const save = async () => {
    setError(null);
    if (!vo.trim()) return setError('Enter the VO number');
    if (!v && !title.trim()) return setError('Enter the title');
    const used = lines.filter((l) => l.description.trim() || l.amount || l.qty);
    if (!used.length) return setError('Add the lines – description and amount');
    const bad = used.findIndex((l) => !l.description.trim() || !((num(l.qty) != null && num(l.rate) != null) || num(l.amount) != null));
    if (bad >= 0) return setError(`Line ${bad + 1}: give the description and a quantity and rate, or an amount`);
    const payload = used.map((l) => ({ description: l.description.trim(), unit: l.unit.trim() || null, qty: num(l.qty), rate: num(l.rate), amount: num(l.amount) }));
    await dialog.run(async () => {
      if (v) {
        await rpc('record_variation_client', { p_id: v.id, p_accepted: true, p: { vo_no: vo.trim(), date, month, note, lines: payload } });
        router.replace(`/execution/variation/${v.id}`);
      } else {
        const id = await rpc<string>('add_approved_variation', {
          p_exec: project,
          p: { vo_no: vo.trim(), title: title.trim(), description: desc.trim(), client_ref: ref.trim(), date, month, vtype, note, lines: payload },
        });
        router.replace(`/execution/variation/${id}`);
      }
    }, 'Added to the BOQ – the AE measures it separately');
  };

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: v ? 'Approved by the client' : 'Approved variation' }} />
      <TestingBanner what="Variations" />
      <ErrorBanner message={error} />
      <Section title={v ? `${v.code} · ${v.title}` : 'Variation approved by the client / consultant'}>
        <Card>
          {v ? (
            <Notice>{`Priced at ${fmtMoney(Math.abs(Number(v.value_lkr ?? 0)), 'LKR')}. Enter the lines as approved by the client / consultant – the value may be adjusted. Attach the signed VO on the variation first.`}</Notice>
          ) : (
            <Muted>A variation the client / consultant has already approved (not raised in the app). It goes into the BOQ as its own section; the AE measures it separately.</Muted>
          )}
          <Grid min={220}>
            <Field label="VO number" required value={vo} onChangeText={setVo} placeholder="e.g. VO-07" />
            <DateField label="Approved on" required value={date} onChange={setDate} />
            <DateField label="Invoice month (for the schedule)" value={month} onChange={setMonth} />
          </Grid>
          {!v ? (
            <>
              <Field label="Title" required value={title} onChangeText={setTitle} placeholder="e.g. Additional DB at the pavilion" />
              <Field label="Description" multiline value={desc} onChangeText={setDesc} />
              <Grid min={220}>
                <Field label="Client / consultant reference" value={ref} onChangeText={setRef} />
                <Segmented value={vtype} onChange={setVtype} options={[{ value: 'addition', label: 'Addition' }, { value: 'omission', label: 'Omission' }]} />
              </Grid>
            </>
          ) : null}
        </Card>
      </Section>
      <Section title={`Lines (${lines.length})`} right={<Button small variant="secondary" title="+ Line" onPress={() => setLines((s) => [...s, blank()])} />}>
        {lines.map((l, i) => (
          <Card key={i} style={{ marginBottom: 8, gap: 4 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`Line ${i + 1}${lineValue(l) ? ` · ${fmtMoney(lineValue(l), 'LKR')}` : ''}`}</Text>
              {lines.length > 1 ? <Button small variant="ghost" title="Remove" onPress={() => setLines((s) => s.filter((_, k) => k !== i))} /> : null}
            </Row>
            <Field label="Description" required value={l.description} onChangeText={(x) => setLine(i, { description: x })} />
            <Grid min={140}>
              <Field label="Unit" value={l.unit} onChangeText={(x) => setLine(i, { unit: x })} placeholder="nos, m, sum" />
              <Field label="Quantity" value={l.qty} onChangeText={(x) => setLine(i, { qty: x })} keyboardType="decimal-pad" />
              <Field label="Rate (LKR)" value={l.rate} onChangeText={(x) => setLine(i, { rate: x })} keyboardType="decimal-pad" />
              <Field label="or Amount (LKR)" value={l.amount} onChangeText={(x) => setLine(i, { amount: x })} keyboardType="decimal-pad" />
            </Grid>
          </Card>
        ))}
        <Text style={{ fontWeight: '700', color: colors.ink, textAlign: 'right' }}>{`Total ${vtype === 'omission' && !v ? '−' : ''}${fmtMoney(total, 'LKR')}`}</Text>
      </Section>
      <Field label="Note" multiline value={note} onChangeText={setNote} />
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Add to the BOQ" onPress={save} />
      </Row>
    </Screen>
  );
}
