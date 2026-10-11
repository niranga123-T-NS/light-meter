import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, colors, Field, Muted, Pill, Row } from '@/components/ui';
import { fmtDate, fmtNumber } from '@/lib/format';
import { conditionTone, type StockMatch } from '@/lib/returns';
import { rpc } from '@/lib/supabase';

/**
 * Similar or the same items already held – in the Project returns stock (can be taken: reserved now, booked out on receipt)
 * and in the SAP stock (noted on the request so Operations issues it from SAP instead of buying).
 */
export function StockMatches({
  text,
  mpn,
  chosen,
  onUseReturn,
  onUseSap,
  onOrderNew,
  onReason,
  onFound,
}: {
  text: string;
  mpn?: string | null;
  chosen: { returnId?: string | null; sapMaterial?: string | null; orderNew?: boolean; reason?: string };
  onUseReturn: (m: StockMatch | null) => void;
  onUseSap: (m: StockMatch | null) => void;
  /** Buy new although stock matches – with the reason */
  onOrderNew: (on: boolean) => void;
  onReason: (v: string) => void;
  /** Tells the form whether stock matched (then a choice is required) */
  onFound?: (found: boolean) => void;
}) {
  const q = text.trim();
  const key = `${q}|${mpn ?? ''}`;
  const enough = q.length >= 3 || !!mpn;
  const [res, setRes] = useState<{ key: string; list: StockMatch[] } | null>(null);
  useEffect(() => {
    if (!enough) return;
    let live = true;
    const t = setTimeout(() => {
      rpc<StockMatch[]>('stock_matches', { p_text: q, p_mpn: mpn ?? null })
        .then((r) => live && setRes({ key, list: r ?? [] }))
        .catch(() => live && setRes({ key, list: [] }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, q, mpn, enough]);
  const list = enough && res?.key === key ? res.list : null;
  const found = !!list?.length;
  useEffect(() => {
    onFound?.(found);
  }, [found, onFound]);
  useEffect(() => () => onFound?.(false), [onFound]);
  if (!list?.length) return null;
  const returns = list.filter((m) => m.source === 'returns');
  const sap = list.filter((m) => m.source === 'sap');
  const row = (m: StockMatch) => {
    const isReturn = m.source === 'returns';
    const picked = isReturn ? chosen.returnId === m.ref : chosen.sapMaterial === m.ref;
    return (
      <Row key={`${m.source}${m.ref}`} gap={8} style={{ alignItems: 'center', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.line }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: picked ? '700' : '500' }}>{m.item}</Text>
          <Muted>
            {[
              isReturn ? `${fmtNumber(m.available, 2)} ${m.unit ?? ''} available` : `${fmtNumber(m.available, 2)} ${m.unit ?? ''} in SAP (${fmtDate(m.as_at)})`,
              m.mpn ? `part ${m.mpn}` : null,
              isReturn ? (m.location ? `at ${m.location}` : null) : `material ${m.ref}`,
              m.age,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </View>
        {isReturn && m.condition ? <Pill label={m.condition} tone={conditionTone(m.condition)} /> : null}
        <Button
          small
          variant={picked ? 'primary' : 'secondary'}
          title={picked ? 'Chosen ✓' : isReturn ? 'Take from returns' : 'Use SAP stock'}
          onPress={() => (isReturn ? onUseReturn(picked ? null : m) : onUseSap(picked ? null : m))}
        />
      </Row>
    );
  };
  return (
    <View style={{ backgroundColor: '#F0F9FF', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#BAE6FD' }}>
      <Text style={{ fontWeight: '700', color: '#075985' }}>Already in stock – use these before buying</Text>
      {returns.length ? (
        <>
          <Muted style={{ marginTop: 4 }}>Project returns</Muted>
          {returns.map(row)}
        </>
      ) : null}
      {sap.length ? (
        <>
          <Muted style={{ marginTop: 4 }}>SAP stock</Muted>
          {sap.map(row)}
        </>
      ) : null}
      <Row gap={8} style={{ alignItems: 'center', paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: chosen.orderNew ? '700' : '500' }}>None of these – order new</Text>
          <Muted>Give the reason (different specification, condition, quantity …)</Muted>
        </View>
        <Button small variant={chosen.orderNew ? 'primary' : 'secondary'} title={chosen.orderNew ? 'Order new ✓' : 'Order new'} onPress={() => onOrderNew(!chosen.orderNew)} />
      </Row>
      {chosen.orderNew ? (
        <Field label="Reason for ordering new" required value={chosen.reason ?? ''} onChangeText={onReason} placeholder="e.g. client specified 5700K – the returns stock is 4000K" />
      ) : null}
      {!chosen.returnId && !chosen.sapMaterial && !chosen.orderNew ? (
        <Muted style={{ color: colors.red, marginTop: 4 }}>Choose one: take from Project returns, use SAP stock, or order new.</Muted>
      ) : null}
    </View>
  );
}
