import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { FxTable, FxTrend } from '@/components/FxRates';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { openAttachment, pickDocument, readBytes, uploadAttachment, uuid } from '@/lib/files';
import { fmtDate, todayISO } from '@/lib/format';
import { FX_CCY, FX_SEES, FX_UPLOAD, fmtRate, parseCombankReport, rateOf, type CombankRow, type Ccy, type FxBoard } from '@/lib/fx';
import { useLoad } from '@/lib/hooks';
import { pdfText } from '@/lib/pdfText';
import { rpc } from '@/lib/supabase';

const PERIODS = { '30': 30, '90': 90, '365': 365 } as const;

/** Exchange rates: Central Bank, Commercial Bank (uploaded daily by the Operations Executive) and Customs, with the trend */
export default function FxScreen() {
  const me = useMe();
  const dialog = useDialog();
  const [days, setDays] = useState<keyof typeof PERIODS>('90');
  const uploader = FX_UPLOAD.includes(me.role);
  const { data, error, loading, reload } = useLoad(async () => rpc<FxBoard>('fx_board', { p_days: 400 }), []);
  if (!FX_SEES.includes(me.role)) return <Screen><Notice>Exchange rates are shown to the GM / DGM, SM Projects, the Estimation team and the Operations Executive.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  // ---- Operations Executive: the Commercial Bank report ----
  const save = async (date: string, rates: Partial<Record<Ccy, CombankRow>>, file?: { id: string; name: string }) => {
    const ok = await dialog.confirm(
      `Commercial Bank rates of ${fmtDate(date)}`,
      FX_CCY.map((c) => {
        const r = rates[c];
        return r ? `${c}: TT buy ${fmtRate(r.tt_buy)} · TT sell ${fmtRate(r.tt_sell)} · 3 months sell ${fmtRate(r.sell_3m)} / buy ${fmtRate(r.buy_3m)}` : `${c}: –`;
      }).join('\n'),
      { confirmLabel: 'Save the rates' },
    );
    if (!ok) return;
    await dialog.run(async () => {
      await rpc('save_combank_rates', { p: { date, rates, doc_id: file?.id ?? null, ref: file?.name ?? null } });
      await reload();
    }, 'Saved – the dashboards show the new rates');
  };
  const upload = async () => {
    const f = await pickDocument();
    if (!f) return;
    let parsed: ReturnType<typeof parseCombankReport> | null = null;
    try {
      parsed = parseCombankReport(await pdfText(await readBytes(f)));
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : 'Could not read the PDF', 'error');
    }
    if (!parsed || parsed.missing.length || !parsed.date) {
      if (parsed) dialog.toast(`Could not read ${parsed.missing.join(', ') || 'the date'} from the report – type the rates in`, 'error');
      return manual();
    }
    let att: { id: string; name: string } | undefined;
    const okUp = await dialog.run(async () => {
      const a = await uploadAttachment('fx_report', uuid(), 'fx_report', f);
      att = { id: a.id, name: f.name };
    });
    if (okUp) await save(parsed.date, parsed.rates, att);
  };
  const manual = async () => {
    const last = data.combank.rows;
    const fields = [
      { key: 'date', label: 'Date of the report', type: 'date' as const, required: true, initial: todayISO() },
      ...FX_CCY.flatMap((c) => {
        const r = rateOf(last, c);
        const f = (k: string, l: string, v: number | null | undefined, req = true) => ({ key: `${c}_${k}`, label: `${c} – ${l}`, required: req, initial: v != null ? String(v) : '' });
        return [
          f(c === 'USD' ? 'mid' : 'cross_usd', c === 'USD' ? 'middle rate' : 'cross rate (USD per unit)', c === 'USD' ? r?.mid : r?.cross_usd, false),
          f('tt_buy', 'TT buying', r?.tt_buy),
          f('tt_sell', 'TT selling', r?.tt_sell),
          f('sell_3m', '3 months selling (forward)', r?.sell_3m),
          f('buy_3m', '3 months buying (discounted)', r?.buy_3m, false),
        ];
      }),
    ];
    const res = await dialog.prompt({ title: 'Commercial Bank rates', message: 'Type the rates from the bank’s report (yesterday’s values are filled in – change them).', fields, confirmLabel: 'Next' });
    if (!res) return;
    const n = (v?: string) => (v ? Number(v.replace(/,/g, '')) : undefined);
    const rates = Object.fromEntries(
      FX_CCY.map((c) => [c, { mid: n(res[`${c}_mid`]), cross_usd: n(res[`${c}_cross_usd`]), tt_buy: n(res[`${c}_tt_buy`])!, tt_sell: n(res[`${c}_tt_sell`])!, sell_3m: n(res[`${c}_sell_3m`])!, buy_3m: n(res[`${c}_buy_3m`]) }]),
    ) as Record<Ccy, CombankRow>;
    await save(res.date, rates);
  };
  const customs = async () => {
    const cu = data.customs.rows;
    const res = await dialog.prompt({
      title: 'Sri Lanka Customs rates',
      message: 'From the schedule on www.customs.gov.lk → Exchange Rates (4 decimals).',
      fields: [
        { key: 'from', label: 'Effective from', type: 'date', required: true },
        { key: 'to', label: 'Effective to', type: 'date', required: true },
        ...FX_CCY.map((c) => ({ key: c, label: `${c} (Rs.)`, required: true, initial: rateOf(cu, c)?.mid != null ? String(rateOf(cu, c)!.mid) : '' })),
      ],
      confirmLabel: 'Save',
    });
    if (res) await dialog.run(async () => { await rpc('save_customs_rates', { p: res }); await reload(); }, 'Customs rates saved');
  };
  const report = rateOf(data.combank.rows, 'USD');
  const customsRef = rateOf(data.customs.rows, 'USD')?.ref;

  return (
    <Screen maxWidth={1200} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Exchange rates' }} />
      <Muted>
        USD, EUR and GBP in rupees. Central Bank indicative rates come in automatically every working day; the Commercial Bank rates (TT, LC and forward) from the
        bank&apos;s daily report uploaded by the Operations Executive (Monday – Friday); the Sri Lanka Customs rates from the weekly schedule on the Customs website.
      </Muted>
      {uploader ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Commercial Bank report</Text>
          <Muted>
            {data.combank.date === data.today ? `Today’s report is in (${fmtDate(data.today)}).` : 'Upload today’s “Indicative Exchange Rates” PDF from the Commercial Bank – from the computer or the phone (by 9:00 on working days).'}
          </Muted>
          <Row wrap gap={8}>
            <Button title="Upload the bank’s report (PDF)" onPress={upload} />
            <Button variant="secondary" title="Type the rates in" onPress={manual} />
            <Button variant="ghost" title="Enter / correct Customs rates" onPress={customs} />
          </Row>
        </Card>
      ) : null}
      <Section title="Rates">
        <Card>
          <FxTable board={data} full />
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {report?.doc_id ? <Button small variant="secondary" title={`Bank report ${fmtDate(data.combank.date)}`} onPress={() => openAttachment({ id: report.doc_id!, file_name: report.ref ?? 'report.pdf' })} /> : null}
            {customsRef?.startsWith('http') ? <Button small variant="secondary" title="Customs schedule (PDF)" onPress={() => Linking.openURL(customsRef)} /> : null}
            <Button small variant="ghost" title="Customs website" onPress={() => Linking.openURL('https://www.customs.gov.lk/exchange-rates/')} />
            <Button small variant="ghost" title="Central Bank website" onPress={() => Linking.openURL('https://www.cbsl.gov.lk/en/rates-and-indicators/exchange-rates')} />
          </Row>
        </Card>
      </Section>
      <Section title="Trend" right={<Segmented value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '3 months' }, { value: '365', label: '1 year' }]} />}>
        <Card style={{ gap: 16 }}>
          {FX_CCY.map((c) => (
            <View key={c}>
              <FxTrend board={data} ccy={c} days={PERIODS[days]} height={170} />
            </View>
          ))}
          <Muted>Central Bank: daily, back one year. Commercial Bank and Customs: from the day they were first entered.</Muted>
        </Card>
      </Section>
    </Screen>
  );
}
