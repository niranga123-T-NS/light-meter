import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DataTable, type Column } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { BASIS_LABEL, cashOf, compareRows, lkr0, lkrM, loadPackage, loadRefs, payText, quoteTotals, SPEC_LABEL, type SqQuote } from '@/lib/supplierQuotes';
import { rpc, supabase } from '@/lib/supabase';

type Cell = { t: ReactNode; tone?: 'good' | 'warn' | 'bad'; sub?: string };
type CRow = { key: string; kind: 'sec' | 'line' | 'row' | 'total'; label: string; sub?: string | null; href?: string; cells: (Cell | null)[] };
const TONE = { good: { bg: '#E4F3EA', fg: '#1A6B41' }, warn: { bg: '#FDF0DC', fg: '#8A4B0F' }, bad: { bg: '#FBE6E4', fg: '#A1281C' } };

/** A package: its quotes side by side on one basis (LKR delivered, exclusions priced back), the terms that decide, and the choice. */
export default function Package() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqAccess } = useAuth();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => ({ ...(await loadPackage(id)), ...(await loadRefs()) }), [id]);
  if (!sqAccess) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { pkg, quotes, suppliers, items, costPct } = data;
  const today = todayISO();
  const sup = (q: SqQuote) => suppliers.find((s) => s.id === q.supplier_id)?.name ?? '—';
  const tots = quotes.map(quoteTotals);
  const cash = quotes.map((q, i) => cashOf(q, tots[i].total, costPct));
  const lowTotal = quotes.length > 1 ? Math.min(...tots.map((t) => t.total)) : null;
  const chosen = quotes.find((q) => q.id === pkg.selected_quote_id);
  const closed = pkg.status === 'closed' || pkg.status === 'cancelled';

  // ---- rows of the comparison
  const rows: CRow[] = [];
  rows.push({ key: 's1', kind: 'sec', label: 'Priced lines – LKR per unit delivered · amount', cells: [] });
  for (const r of compareRows(quotes, items)) {
    rows.push({
      key: r.key, kind: 'line', label: r.label, sub: r.sub, href: r.item_id ? `/supplier-quotes/item/${r.item_id}` : undefined,
      cells: r.cells.map((c) => (c ? { t: c.included ? 'included' : `${lkr0(c.unit)}`, sub: c.included ? undefined : `${c.qty ?? ''} × · ${lkrM(c.amount)} · quoted ${c.written}`, tone: c.unit != null && r.low != null && c.unit === r.low ? 'good' : undefined } : { t: '—', sub: 'not quoted', tone: 'warn' })),
    });
  }
  rows.push({ key: 's2', kind: 'sec', label: 'Bringing the quotes to the same basis', cells: [] });
  rows.push({ key: 'ccy', kind: 'row', label: 'Currency', sub: 'exchange rate used (LKR per unit)', cells: quotes.map((q) => ({ t: q.currency === 'LKR' ? 'LKR' : `${q.currency} × ${q.fx_rate}` })) });
  rows.push({ key: 'basis', kind: 'row', label: 'Delivery basis', sub: 'freight, duty, clearing added', cells: quotes.map((q) => ({ t: BASIS_LABEL[q.delivery_basis], sub: q.freight_pct ? `+${q.freight_pct} % added` : undefined, tone: q.freight_pct ? 'warn' : undefined })) });
  rows.push({ key: 'excl', kind: 'row', label: 'Exclusions priced back', sub: 'from each quote\'s exclusions', cells: quotes.map((q, i) => ({ t: tots[i].excl ? `+${lkrM(tots[i].excl)}` : '–', sub: q.exclusions.map((x) => x.text).join(', ') || undefined, tone: tots[i].excl ? 'warn' : undefined })) });
  rows.push({ key: 'tot', kind: 'total', label: 'Comparable total (LKR)', cells: quotes.map((q, i) => ({ t: lkrM(tots[i].total), sub: q.currency === 'LKR' ? `as written ${lkrM(tots[i].written)}` : `as written ${q.currency} ${lkr0(tots[i].written)}`, tone: lowTotal != null && tots[i].total === lowTotal ? 'good' : undefined })) });
  rows.push({ key: 's3', kind: 'sec', label: 'Not price – but it decides', cells: [] });
  rows.push({ key: 'lead', kind: 'row', label: 'Lead time', sub: pkg.needed_weeks ? `needed within ${pkg.needed_weeks} weeks` : undefined, cells: quotes.map((q) => ({ t: q.lead_weeks != null ? `${q.lead_weeks} weeks` : 'not given', tone: q.lead_weeks == null ? 'warn' : pkg.needed_weeks && q.lead_weeks > pkg.needed_weeks ? 'bad' : 'good' })) });
  rows.push({ key: 'pay', kind: 'row', label: 'Payment terms', sub: 'stages from each quote', cells: quotes.map((q) => ({ t: payText(q), tone: !q.payments.length ? 'warn' : undefined })) });
  rows.push({ key: 'cash', kind: 'row', label: 'Cash out before delivery', sub: 'money tied up before the goods arrive', cells: cash.map((c) => (c ? { t: c.before ? lkrM(c.before) : 'none', sub: c.before ? `from ${c.weeksBefore} weeks before` : undefined, tone: c.before ? 'warn' : 'good' } : { t: '—' })) });
  rows.push({ key: 'cost', kind: 'row', label: 'Cost of paying early', sub: `at ${costPct} % a year – shown, not added`, cells: cash.map((c) => (c ? { t: c.cost >= 0 ? `≈ ${lkrM(c.cost)}` : `saves ≈ ${lkrM(-c.cost)}`, tone: c.cost > 0 ? 'warn' : 'good' } : { t: '—' })) });
  rows.push({ key: 'valid', kind: 'row', label: 'Quote valid until', sub: pkg.our_validity ? `our quotation: ${fmtDate(pkg.our_validity)}` : undefined, cells: quotes.map((q) => ({ t: q.valid_until ? fmtDate(q.valid_until) : 'not given', tone: !q.valid_until ? 'warn' : q.valid_until < today ? 'bad' : pkg.our_validity && q.valid_until < pkg.our_validity ? 'bad' : 'good', sub: q.valid_until && q.valid_until < today ? 'ended' : q.valid_until && pkg.our_validity && q.valid_until < pkg.our_validity ? 'ends before ours' : undefined })) });
  rows.push({ key: 'war', kind: 'row', label: 'Warranty', cells: quotes.map((q) => ({ t: q.warranty ?? '—' })) });
  rows.push({ key: 'spec', kind: 'row', label: 'Meets the specification', cells: quotes.map((q) => ({ t: SPEC_LABEL[q.meets_spec], sub: q.spec_note ?? undefined, tone: q.meets_spec === 'yes' ? 'good' : q.meets_spec === 'unknown' ? 'warn' : 'bad' })) });
  if (quotes.some((q) => q.retention_pct || q.adv_guarantee)) rows.push({ key: 'ret', kind: 'row', label: 'Retention · advance guarantee', cells: quotes.map((q) => ({ t: `${q.retention_pct ? `${q.retention_pct} %` : 'none'} · ${q.adv_guarantee ? 'guarantee needed' : 'no guarantee'}` })) });

  const columns: Column<CRow>[] = [
    {
      h: 'Line', w: 230, grow: true,
      v: (r) => r.kind === 'sec'
        ? <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{r.label}</Text>
        : <View>
            <Text style={{ fontWeight: r.kind === 'total' ? '800' : '600', color: colors.ink }}>{r.label}</Text>
            {r.sub ? <Muted>{r.sub}</Muted> : null}
            {r.href ? <Pressable onPress={() => router.push(r.href as never)}><Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: '600' }}>Price history ›</Text></Pressable> : null}
          </View>,
    },
    ...quotes.map((q, i): Column<CRow> => ({
      h: `${sup(q)}${q.quote_no ? ` · ${q.quote_no}` : ''}`, w: 210,
      v: (r) => {
        const c = r.cells[i];
        if (r.kind === 'sec' || !c) return '';
        const t = c.tone ? TONE[c.tone] : null;
        return (
          <View style={{ backgroundColor: t?.bg, borderRadius: 6, padding: t ? 4 : 0, alignSelf: 'stretch' }}>
            <Text style={{ color: t?.fg ?? colors.ink, fontWeight: r.kind === 'total' ? '800' : '500' }}>{c.t}</Text>
            {c.sub ? <Muted>{c.sub}</Muted> : null}
          </View>
        );
      },
    })),
  ];

  const select = async (q: SqQuote) => {
    const cheaper = lowTotal != null && quoteTotals(q).total > lowTotal;
    const r = await dialog.prompt({
      title: `Choose ${sup(q)}?`,
      message: cheaper ? 'This is not the lowest comparable total – say why it is the better choice.' : 'The reason is kept with the package.',
      fields: [{ key: 'reason', label: 'Reason for the choice', type: 'multiline', required: true }],
      confirmLabel: 'Choose',
    });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_select', { p_package: pkg.id, p_quote: q.id, p_reason: r.reason }); reload(); }, 'Supplier chosen');
  };
  const unselect = async () => {
    if (!(await dialog.confirm('Clear the choice?', 'The package goes back to comparing.'))) return;
    await dialog.run(async () => { await rpc('sq_select', { p_package: pkg.id, p_quote: null }); reload(); });
  };
  const del = async (q: SqQuote) => {
    if (!(await dialog.confirm(`Delete ${sup(q)}'s quote?`, 'Its lines leave the price history too.', { danger: true, confirmLabel: 'Delete' }))) return;
    await dialog.run(async () => { const { error: e } = await supabase.from('sq_quotes').delete().eq('id', q.id); if (e) throw new Error(e.message); reload(); });
  };
  const edit = async () => {
    const r = await dialog.prompt({
      title: 'Edit package',
      fields: [
        { key: 'title', label: 'Package', required: true, initial: pkg.title },
        { key: 'project', label: 'Project / client', initial: pkg.project_name ?? '' },
        { key: 'job', label: 'Job or inquiry reference', initial: pkg.job_ref ?? '' },
        { key: 'valid', label: 'Our quotation is valid until', type: 'date', initial: pkg.our_validity ?? '' },
        { key: 'weeks', label: 'Needed on site within (weeks)', initial: pkg.needed_weeks ? String(pkg.needed_weeks) : '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: pkg.notes ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_packages').update({ title: r.title.trim(), project_name: r.project?.trim() || null, job_ref: r.job?.trim() || null, our_validity: r.valid || null, needed_weeks: Number(r.weeks) > 0 ? Number(r.weeks) : null, notes: r.notes?.trim() || null }).eq('id', pkg.id);
      if (e) throw new Error(e.message);
      reload();
    }, 'Saved');
  };
  const setStatus = async (status: 'closed' | 'cancelled' | 'open') => {
    if (status !== 'open' && !(await dialog.confirm(status === 'closed' ? 'Close the package?' : 'Cancel the package?', 'The quotes stay in the price history.'))) return;
    const back = status === 'open' && pkg.selected_quote_id ? 'selected' : status;
    await dialog.run(async () => { const { error: e } = await supabase.from('sq_packages').update({ status: back }).eq('id', pkg.id); if (e) throw new Error(e.message); reload(); });
  };

  const warnings = [
    ...quotes.filter((q) => q.valid_until && q.valid_until < today).map((q) => `${sup(q)}'s quote ended on ${fmtDate(q.valid_until)}.`),
    ...quotes.filter((q) => q.valid_until && q.valid_until >= today && pkg.our_validity && q.valid_until < pkg.our_validity).map((q) => `${sup(q)}'s quote ends on ${fmtDate(q.valid_until)}, before our quotation (${fmtDate(pkg.our_validity)}) – ask them to extend it.`),
    ...quotes.filter((q) => pkg.needed_weeks && q.lead_weeks && q.lead_weeks > pkg.needed_weeks).map((q) => `${sup(q)} needs ${q.lead_weeks} weeks – longer than the ${pkg.needed_weeks} weeks allowed.`),
  ];

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: pkg.title }} />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Muted>{[pkg.code, pkg.kind === 'supply' ? 'Supply' : 'Subcontract', pkg.project_name, pkg.job_ref].filter(Boolean).join(' · ')}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{pkg.title}</Text>
        </View>
        <Row wrap gap={8}>
          {!closed ? <Button title="Add a quote" icon="＋" onPress={() => router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id } })} /> : null}
          <Button variant="secondary" title="Edit" onPress={edit} />
          {closed ? <Button variant="secondary" title="Reopen" onPress={() => setStatus('open')} /> : <Button variant="secondary" title="Close" onPress={() => setStatus('closed')} />}
          {pkg.status === 'open' ? <Button variant="ghost" title="Cancel package" onPress={() => setStatus('cancelled')} /> : null}
        </Row>
      </Row>
      <Grid min={180} max={4}>
        <Stat label="Quotes" value={String(quotes.length)} />
        <Stat label="Lowest comparable" value={lowTotal != null ? `LKR ${lkrM(lowTotal)}` : quotes.length ? `LKR ${lkrM(tots[0].total)}` : '—'} sub={quotes.length ? sup(quotes[tots.findIndex((t) => t.total === Math.min(...tots.map((x) => x.total)))]) : undefined} />
        <Stat label="Our quotation valid until" value={pkg.our_validity ? fmtDate(pkg.our_validity) : '—'} />
        <Stat label="Chosen" value={chosen ? sup(chosen) : '—'} tone={chosen ? 'green' : undefined} sub={chosen ? `LKR ${lkrM(quoteTotals(chosen).total)}` : undefined} />
      </Grid>
      {warnings.length ? <Notice tone={colors.amber}>{warnings.join('\n')}</Notice> : null}
      {!quotes.length ? (
        <Card><Empty title="No quotes yet" hint="Add each supplier's quote – upload their Excel or PDF to read the lines, or type them in." /></Card>
      ) : (
        <>
          <DataTable rows={rows} keyOf={(r) => r.key} columns={columns} rowStyle={(r) => (r.kind === 'sec' ? { backgroundColor: '#F6F8F7' } : r.kind === 'total' ? { borderTopWidth: 2, borderTopColor: colors.ink } : undefined)} />
          <Card>
            <Row wrap gap={10}>
              {quotes.map((q) => (
                <View key={q.id} style={{ minWidth: 200, flexGrow: 1, gap: 6 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{sup(q)}</Text>
                  <Muted>{`${q.quote_no ?? 'no ref.'} · ${q.quote_date ? fmtDate(q.quote_date) : 'no date'} · ${{ manual: 'typed in', excel: 'read from Excel', pdf: 'read from PDF' }[q.source]}`}</Muted>
                  <Row wrap gap={6}>
                    {!closed ? <Button small title={pkg.selected_quote_id === q.id ? 'Chosen ✓' : 'Choose'} variant={pkg.selected_quote_id === q.id ? 'primary' : 'secondary'} onPress={() => (pkg.selected_quote_id === q.id ? unselect() : select(q))} /> : null}
                    <Button small variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id, id: q.id } })} />
                    <Button small variant="ghost" title="Delete" onPress={() => del(q)} />
                  </Row>
                </View>
              ))}
            </Row>
          </Card>
        </>
      )}
      {chosen ? (
        <Section title="Choice">
          <Card>
            <KeyValue label="Supplier" value={sup(chosen)} />
            <KeyValue label="Reason" value={pkg.selection_reason ?? '—'} wide />
            <KeyValue label="Chosen by" value={`${people[pkg.selected_by ?? '']?.full_name ?? '—'} · ${fmtDate(pkg.selected_at)}`} />
          </Card>
        </Section>
      ) : null}
      {pkg.notes ? <Card><Muted>{pkg.notes}</Muted></Card> : null}
      <Muted>{'Green = lowest on the row. Commissioning and handover payments are taken 30 and 60 days after delivery; with no lead time given, 8 weeks is assumed.'}</Muted>
      <Pill label="Supplier prices: Operations, GM / DGM and people the GM / DGM allows" tone={colors.grey} />
    </Screen>
  );
}
