import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card, colors, Empty, Loading, Muted, Pill, Row, styles } from '@/components/ui';
import { fmtDate, fmtNumber } from '@/lib/format';
import { conditionTone, type StockMatch } from '@/lib/returns';
import { rpc } from '@/lib/supabase';

type Step = 1 | 2 | 3;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Project returns' },
  { n: 2, label: 'SAP stock' },
  { n: 3, label: 'New material' },
];

/**
 * Adding an item to a material request goes in steps, so existing stock is used first:
 * 1 the Project returns, 2 the SAP stock, and only then 3 a new item (catalogue or custom).
 */
export function AddItemSteps({
  onTakeReturn,
  onUseSap,
  onNew,
  onCancel,
}: {
  onTakeReturn: (m: StockMatch) => void;
  onUseSap: (m: StockMatch) => void;
  /** Reached only after both stocks were searched; the search text is carried into the new item */
  onNew: (searched: string) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [q, setQ] = useState('');
  const term = q.trim();
  const source = step === 1 ? 'returns' : 'sap';
  const key = `${source}|${term}`;
  const [res, setRes] = useState<{ key: string; list: StockMatch[] } | null>(null);
  useEffect(() => {
    if (step === 3 || term.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      rpc<StockMatch[]>('stock_matches', { p_text: term, p_mpn: term, p_source: source })
        .then((r) => live && setRes({ key, list: r ?? [] }))
        .catch(() => live && setRes({ key, list: [] }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, term, source, step]);
  const list = res?.key === key ? res.list : null;
  const searched = term.length >= 3 && list != null;

  return (
    <Card style={{ gap: 8, borderWidth: 2, borderColor: colors.brand }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>Add an item</Text>
        {onCancel ? <Button small variant="ghost" title="Cancel" onPress={onCancel} /> : null}
      </Row>
      <Row gap={6} wrap>
        {STEPS.map((s) => (
          <Pill key={s.n} label={`${s.n}  ${s.label}`} tone={s.n === step ? colors.brand : s.n < step ? colors.green : colors.grey} solid={s.n === step} />
        ))}
      </Row>
      {step < 3 ? (
        <>
          <Muted>
            {step === 1
              ? 'First check the Project returns – leftover material from other projects. Type what you need (description or part number).'
              : 'Not in the Project returns – now check the SAP stock.'}
          </Muted>
          <TextInput value={q} onChangeText={setQ} placeholder="e.g. floodlight 1500W, cable 16 mm, gland 32" placeholderTextColor={colors.faint} style={styles.input} autoFocus />
          {term.length < 3 ? (
            <Muted>Type at least 3 letters to search.</Muted>
          ) : list == null ? (
            <Loading />
          ) : list.length ? (
            list.map((m) => (
              <Row key={`${m.source}${m.ref}`} gap={8} style={{ alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{m.item}</Text>
                  <Muted>
                    {[
                      step === 1 ? `${fmtNumber(m.available, 2)} ${m.unit ?? ''} available` : `${fmtNumber(m.available, 2)} ${m.unit ?? ''} in SAP (${fmtDate(m.as_at)})`,
                      m.mpn ? `part ${m.mpn}` : null,
                      step === 1 ? (m.location ? `at ${m.location}` : null) : `material ${m.ref}`,
                      m.age,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                </View>
                {step === 1 && m.condition ? <Pill label={m.condition} tone={conditionTone(m.condition)} /> : null}
                <Button small title={step === 1 ? 'Take' : 'Use SAP stock'} onPress={() => (step === 1 ? onTakeReturn(m) : onUseSap(m))} />
              </Row>
            ))
          ) : (
            <Empty title={step === 1 ? 'Nothing matching in the Project returns' : 'Nothing matching in the SAP stock'} />
          )}
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            {step === 2 ? <Button small variant="ghost" title="← Project returns" onPress={() => setStep(1)} /> : null}
            <Button
              small
              variant="secondary"
              disabled={!searched}
              title={step === 1 ? 'Not in Project returns – check SAP stock →' : 'Not in SAP stock – new material →'}
              onPress={() => (step === 1 ? setStep(2) : (setStep(3), onNew(term)))}
            />
          </Row>
        </>
      ) : null}
    </Card>
  );
}
