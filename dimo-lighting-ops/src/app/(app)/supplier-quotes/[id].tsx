import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DataTable, type Column } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { atStage, BASIS_LABEL, type BidStage, cashOf, chains, compareRows, jobField, jobSource, lkr0, lkrM, loadJobs, loadPackage, loadRefs, payText, quoteTotals, revLabel, SPEC_LABEL, STAGE_LABEL, type SqItem, type SqJob, type SqQuote } from '@/lib/supplierQuotes';
import { rpc, supabase } from '@/lib/supabase';

type Cell = { t: ReactNode; tone?: 'good' | 'warn' | 'bad'; sub?: string };
type CRow = { key: string; kind: 'sec' | 'line' | 'row' | 'total' | 'act'; label: string; sub?: string | null; href?: string; cells: (Cell | null)[] };
const TONE = { good: { bg: '#E4F3EA', fg: '#1A6B41' }, warn: { bg: '#FDF0DC', fg: '#8A4B0F' }, bad: { bg: '#FBE6E4', fg: '#A1281C' } };

/** A package: its quotes side by side on one basis (LKR delivered, exclusions priced back), the terms that decide, and the choice. */
export default function Package() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqAccess } = useAuth();
  const dialog = useDialog();
  const people = usePeople();
  const [view, setView] = useState<BidStage | null>(null);
  const { data, error, reload } = useLoad(async () => ({ ...(await loadPackage(id)), ...(await loadRefs()), invites: ((await supabase.from('sq_package_invites').select('supplier_id').eq('package_id', id)).data ?? []).map((x) => x.supplier_id as string) }), [id]);
  if (!sqAccess) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { pkg, suppliers, items, costPct } = data;
  // every version is kept; the comparison and the choice use each supplier's latest version of the stage shown (Pre Bid or Post Bid)
  const stage: BidStage = pkg.stage ?? 'pre_bid';
  const shown: BidStage = view ?? stage;
  const quotes = atStage(data.quotes, shown);
  const preQuotes = atStage(data.quotes, 'pre_bid');
  const postCount = stage === 'post_bid' ? atStage(data.quotes, 'post_bid').length : 0;
  const allChains = chains(data.quotes).sort((a, b) => b.length - a.length);
  const chainOf = (q: SqQuote) => allChains.find((c) => c.some((x) => x.id === q.id)) ?? [q];
  const today = todayISO();
  const sup = (q: SqQuote) => suppliers.find((s) => s.id === q.supplier_id)?.name ?? '—';
  const sKind = (q: SqQuote) => (suppliers.find((s) => s.id === q.supplier_id)?.kind === 'manufacturer' ? 'Manufacturer · ' : '');
  const tots = quotes.map(quoteTotals);
  const cash = quotes.map((q, i) => cashOf(q, tots[i].total, costPct));
  const lowTotal = quotes.length > 1 ? Math.min(...tots.map((t) => t.total)) : null;
  const chosen = quotes.find((q) => q.id === pkg.selected_quote_id);
  const closed = pkg.status === 'closed' || pkg.status === 'cancelled';
  // an earlier stage is kept for reference only
  const past = shown !== stage;
  const fixed = closed || past;
  const preOf = (q: SqQuote) => [...chainOf(q)].reverse().find((x) => (x.bid_stage ?? 'pre_bid') === 'pre_bid');
  const preChoice = data.quotes.find((q) => q.id === pkg.pre_bid_quote_id);

  // ---- rows of the comparison
  const rows: CRow[] = [];
  // actions right under each supplier's name
  rows.push({ key: 'act', kind: 'act', label: 'Actions', cells: quotes.map(() => ({ t: '' })) });
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
  if (quotes.some((q) => q.discount_pct || q.discount_amt))
    rows.push({ key: 'disc', kind: 'row', label: 'Discount on the whole quote', sub: 'already taken off the rates above', cells: quotes.map((q) => ({ t: [q.discount_pct ? `${q.discount_pct} %` : '', q.discount_amt ? `${q.currency} ${lkr0(q.discount_amt)}` : ''].filter(Boolean).join(' + ') || '–', tone: q.discount_pct || q.discount_amt ? 'good' : undefined })) });
  rows.push({ key: 'excl', kind: 'row', label: 'Exclusions priced back', sub: 'from each quote\'s exclusions', cells: quotes.map((q, i) => ({ t: tots[i].excl ? `+${lkrM(tots[i].excl)}` : '–', sub: q.exclusions.map((x) => x.text).join(', ') || undefined, tone: tots[i].excl ? 'warn' : undefined })) });
  rows.push({ key: 'tot', kind: 'total', label: 'Comparable total (LKR)', cells: quotes.map((q, i) => ({ t: lkrM(tots[i].total), sub: q.currency === 'LKR' ? `as written ${lkrM(tots[i].written)}` : `as written ${q.currency} ${lkr0(tots[i].written)}`, tone: lowTotal != null && tots[i].total === lowTotal ? 'good' : undefined })) });
  if (quotes.some((q) => q.revision > 0))
    rows.push({ key: 'neg', kind: 'row', label: 'Came down from the first offer', sub: 'see the versions below', cells: quotes.map((q, i) => {
      const c = chainOf(q), f0 = quoteTotals(c[0]).total, d = f0 ? ((tots[i].total - f0) / f0) * 100 : 0;
      return c.length > 1 ? { t: `${d.toFixed(1)} %`, sub: `${lkrM(f0)} → ${lkrM(tots[i].total)} in ${c.length} versions`, tone: d < 0 ? 'good' : d > 0 ? 'bad' : undefined } : { t: 'first offer' };
    }) });
  if (shown === 'post_bid' && preQuotes.length)
    rows.push({ key: 'pre', kind: 'row', label: 'Pre Bid price', sub: 'what our tender was built on', cells: quotes.map((q, i) => {
      const p = preOf(q);
      if (!p) return { t: 'new at Post Bid', tone: 'warn' };
      const f0 = quoteTotals(p).total, d = f0 ? ((tots[i].total - f0) / f0) * 100 : 0;
      return { t: `${d > 0 ? '+' : ''}${d.toFixed(1)} %`, sub: `${lkrM(f0)} at Pre Bid → ${lkrM(tots[i].total)}`, tone: d < 0 ? 'good' : d > 0 ? 'bad' : undefined };
    }) });
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
      v: (r) => r.kind === 'act'
        ? <Muted>{fixed ? (past ? 'Pre Bid – kept as it was' : 'Package closed') : 'Choose, revise or edit'}</Muted>
        : r.kind === 'sec'
        ? <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{r.label}</Text>
        : <View>
            <Text style={{ fontWeight: r.kind === 'total' ? '800' : '600', color: colors.ink }}>{r.label}</Text>
            {r.sub ? <Muted>{r.sub}</Muted> : null}
            {r.href ? <Pressable onPress={() => router.push(r.href as never)}><Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: '600' }}>Price history ›</Text></Pressable> : null}
          </View>,
    },
    ...quotes.map((q, i): Column<CRow> => ({
      h: `${sup(q)}${q.quote_no ? ` · ${q.quote_no}` : ''}${q.revision ? ` · ${revLabel(q)}` : ''}`, w: 210,
      v: (r) => {
        const c = r.cells[i];
        if (r.kind === 'act') return (
          <Row wrap gap={6}>
            {!fixed ? <Button small title={pkg.selected_quote_id === q.id ? 'Chosen ✓' : 'Choose'} variant={pkg.selected_quote_id === q.id ? 'primary' : 'secondary'} onPress={() => (pkg.selected_quote_id === q.id ? unselect() : select(q))} /> : null}
            {!fixed ? <Button small variant="secondary" title="Revised / discounted quote" onPress={() => revise(q)} /> : null}
            {past && !closed && !q.superseded_by ? <Button small variant="secondary" title="Carry into Post Bid" onPress={() => carry(q)} /> : null}
            <Button small variant="ghost" title={fixed || q.superseded_by ? 'View' : 'Edit'} onPress={() => router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id, id: q.id } })} />
          </Row>
        );
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
  const revise = async (q: SqQuote) => {
    const r = await dialog.prompt({
      title: `New version of ${sup(q)}'s quote`,
      message: `A revised or discounted quote. ${revLabel(q)} is kept as it is; ${revLabel({ revision: q.revision + 1 })} starts as a copy for you to change.`,
      fields: [{ key: 'note', label: 'What changed', type: 'multiline', required: true, hint: 'e.g. 5 % discount after the meeting on 24 Oct; floodlight rate reduced' }],
      confirmLabel: 'Create version',
    });
    if (!r) return;
    await dialog.run(async () => {
      const v = await rpc<string>('sq_revise_quote', { p_quote: q.id, p_note: r.note });
      router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id, id: v } });
    });
  };
  const toPostBid = async () => {
    const r = await dialog.prompt({
      title: 'Move to Post Bid',
      message: 'The Pre Bid quotes and choice are kept as they are. Pick the suppliers and manufacturers that go on – each gets a Post Bid version to change. Others stay at Pre Bid; you can still carry them on or add new ones later.',
      fields: [
        ...(preQuotes.length ? [{ key: 'carry', label: 'Going on to Post Bid', type: 'multiselect' as const, initial: preQuotes.map((q) => q.id).join(','), options: preQuotes.map((q) => ({ value: q.id, label: `${sup(q)} · LKR ${lkrM(quoteTotals(q).total)}` })) }] : []),
        { key: 'note', label: 'Note', type: 'multiline', hint: 'e.g. Tender awarded on 24 Oct – final prices asked' },
      ],
      confirmLabel: 'Move to Post Bid',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('sq_post_bid', { p_package: pkg.id, p_carry: (r.carry ?? '').split(',').filter(Boolean), p_note: r.note?.trim() || null });
      setView(null);
      reload();
    }, 'At Post Bid');
  };
  const toPreBid = async () => {
    if (!(await dialog.confirm('Back to Pre Bid?', 'Only while no quote is in at Post Bid. The Pre Bid choice comes back.'))) return;
    await dialog.run(async () => { await rpc('sq_pre_bid', { p_package: pkg.id }); setView(null); reload(); });
  };
  const carry = async (q: SqQuote) => {
    await dialog.run(async () => {
      const v = await rpc<string>('sq_revise_quote', { p_quote: q.id, p_note: 'Carried into Post Bid' });
      setView(null);
      router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id, id: v } });
    });
  };
  // who was asked to quote – the supplier reports measure who quotes when asked; a supplier who quotes counts as asked
  const askedIds = new Set([...data.invites, ...data.quotes.map((q) => q.supplier_id)]);
  const editAsked = async () => {
    const quotedIds = new Set(data.quotes.map((q) => q.supplier_id));
    const r = await dialog.prompt({
      title: 'Asked to quote',
      message: 'The suppliers and manufacturers asked for a price on this package, quoted or not. Those who quoted stay on the list.',
      fields: [{ key: 'ids', label: 'Asked', type: 'multiselect', initial: [...askedIds].join(','), options: suppliers.filter((s) => s.active || askedIds.has(s.id)).map((s) => ({ value: s.id, label: s.name })) }],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const want = new Set((r.ids ?? '').split(',').filter(Boolean));
    await dialog.run(async () => {
      const add = [...want].filter((x) => !data.invites.includes(x) && !quotedIds.has(x)).map((supplier_id) => ({ package_id: pkg.id, supplier_id }));
      const drop = data.invites.filter((x) => !want.has(x) && !quotedIds.has(x));
      if (add.length) { const { error: e } = await supabase.from('sq_package_invites').insert(add); if (e) throw new Error(e.message); }
      if (drop.length) { const { error: e } = await supabase.from('sq_package_invites').delete().eq('package_id', pkg.id).in('supplier_id', drop); if (e) throw new Error(e.message); }
      reload();
    }, 'Saved');
  };
  const del = async (q: SqQuote) => {
    if (!(await dialog.confirm(q.revision ? `Delete ${revLabel(q)} of ${sup(q)}'s quote?` : `Delete ${sup(q)}'s quote?`, q.revision ? `${revLabel({ revision: q.revision - 1 })} becomes the latest again.` : 'Its lines leave the price history too.', { danger: true, confirmLabel: 'Delete' }))) return;
    await dialog.run(async () => { const { error: e } = await supabase.from('sq_quotes').delete().eq('id', q.id); if (e) throw new Error(e.message); reload(); });
  };
  const edit = async () => {
    const jobs = await loadJobs().catch(() => [] as SqJob[]);
    const r = await dialog.prompt({
      title: 'Edit package',
      fields: [
        { key: 'title', label: 'Package', required: true, initial: pkg.title },
        jobField(jobs, pkg.source_kind && pkg.source_id ? `${pkg.source_kind}:${pkg.source_id}` : ''),
        { key: 'project', label: 'Project / client', initial: pkg.project_name ?? '' },
        { key: 'job', label: 'Job or inquiry reference', initial: pkg.job_ref ?? '' },
        { key: 'valid', label: 'Our quotation is valid until', type: 'date', initial: pkg.our_validity ?? '' },
        { key: 'weeks', label: 'Needed on site within (weeks)', initial: pkg.needed_weeks ? String(pkg.needed_weeks) : '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: pkg.notes ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_packages').update({ title: r.title.trim(), project_name: r.project?.trim() || null, job_ref: r.job?.trim() || null, ...jobSource(r.src), our_validity: r.valid || null, needed_weeks: Number(r.weeks) > 0 ? Number(r.weeks) : null, notes: r.notes?.trim() || null }).eq('id', pkg.id);
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
          <Muted>{[pkg.code, pkg.kind === 'supply' ? 'Supply' : 'Subcontract', pkg.project_name, pkg.job_ref, STAGE_LABEL[stage]].filter(Boolean).join(' · ')}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{pkg.title}</Text>
        </View>
        <Row wrap gap={8}>
          {!fixed ? <Button title={stage === 'post_bid' ? 'Add a Post Bid quote' : 'Add a quote'} icon="＋" onPress={() => router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id } })} /> : null}
          {!closed && stage === 'pre_bid' ? <Button variant="secondary" title="Move to Post Bid" onPress={toPostBid} /> : null}
          {!closed && stage === 'post_bid' && !postCount ? <Button variant="ghost" title="Back to Pre Bid" onPress={toPreBid} /> : null}
          <Button variant="secondary" title="Edit" onPress={edit} />
          {closed ? <Button variant="secondary" title="Reopen" onPress={() => setStatus('open')} /> : <Button variant="secondary" title="Close" onPress={() => setStatus('closed')} />}
          {pkg.status === 'open' ? <Button variant="ghost" title="Cancel package" onPress={() => setStatus('cancelled')} /> : null}
        </Row>
      </Row>
      {stage === 'post_bid' ? (
        <Row wrap gap={8} style={{ alignItems: 'center' }}>
          {preQuotes.length ? <Segmented value={shown} onChange={(v) => setView(v as BidStage)} options={[{ value: 'post_bid', label: `Post Bid (${postCount})` }, { value: 'pre_bid', label: `Pre Bid (${preQuotes.length})` }]} /> : <Pill label="Post Bid" tone={colors.blue} />}
          <Muted>{`${preQuotes.length ? 'Moved to Post Bid on' : 'At Post Bid since'} ${fmtDate(pkg.post_bid_at)}${pkg.post_bid_by ? ` by ${people[pkg.post_bid_by]?.full_name ?? '—'}` : ''}${pkg.post_bid_note ? ` · ${pkg.post_bid_note}` : ''}`}</Muted>
        </Row>
      ) : null}
      {past ? <Notice tone={colors.blue}>{`Pre Bid prices – kept as they were for the tender.${preChoice ? ` Chosen at Pre Bid: ${sup(preChoice)}${pkg.pre_bid_reason ? ` (${pkg.pre_bid_reason})` : ''}.` : ''} Carry a supplier on to ask for a Post Bid price.`}</Notice> : null}
      <Grid min={180} max={4}>
        <Stat label="Quotes" value={String(quotes.length)} />
        <Stat label="Lowest comparable" value={lowTotal != null ? `LKR ${lkrM(lowTotal)}` : quotes.length ? `LKR ${lkrM(tots[0].total)}` : '—'} sub={quotes.length ? sup(quotes[tots.findIndex((t) => t.total === Math.min(...tots.map((x) => x.total)))]) : undefined} />
        <Stat label="Our quotation valid until" value={pkg.our_validity ? fmtDate(pkg.our_validity) : '—'} />
        <Stat label={past ? 'Chosen at Post Bid' : 'Chosen'} value={chosen ? sup(chosen) : '—'} tone={chosen ? 'green' : undefined} sub={chosen ? `LKR ${lkrM(quoteTotals(chosen).total)}` : undefined} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Muted>{`Asked to quote: ${[...askedIds].map((x) => `${suppliers.find((s) => s.id === x)?.name ?? '—'}${data.quotes.some((q) => q.supplier_id === x) ? '' : ' (no quote yet)'}`).join(', ') || 'nobody recorded'}`}</Muted>
        {!closed ? <Button small variant="ghost" title="Edit who was asked" onPress={editAsked} /> : null}
      </Row>
      {warnings.length && !past ? <Notice tone={colors.amber}>{warnings.join('\n')}</Notice> : null}
      {!quotes.length ? (
        <Card><Empty title={shown === 'post_bid' ? 'No Post Bid quotes yet' : 'No quotes yet'} hint={shown === 'post_bid' ? 'Carry a Pre Bid supplier on (Pre Bid tab) or add a new supplier or manufacturer.' : 'Add each supplier\'s quote – upload their Excel or PDF to read the lines, or type them in.'} /></Card>
      ) : (
        <>
          <DataTable rows={rows} keyOf={(r) => r.key} columns={columns} rowStyle={(r) => (r.kind === 'sec' ? { backgroundColor: '#F6F8F7' } : r.kind === 'total' ? { borderTopWidth: 2, borderTopColor: colors.ink } : undefined)} />
          <Card>
            <Row wrap gap={10}>
              {quotes.map((q) => (
                <View key={q.id} style={{ minWidth: 200, flexGrow: 1, gap: 6 }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{sup(q)}</Text>
                  <Muted>{`${sKind(q)}${revLabel(q)}${chainOf(q).length > 1 ? ` of ${chainOf(q).length} versions` : ''} · ${q.quote_no ?? 'no ref.'} · ${q.quote_date ? fmtDate(q.quote_date) : 'no date'} · ${{ manual: 'typed in', excel: 'read from Excel', pdf: 'read from PDF' }[q.source]}`}</Muted>
                  <Row wrap gap={6}>
                    {!fixed ? <Button small title={pkg.selected_quote_id === q.id ? 'Chosen ✓' : 'Choose'} variant={pkg.selected_quote_id === q.id ? 'primary' : 'secondary'} onPress={() => (pkg.selected_quote_id === q.id ? unselect() : select(q))} /> : null}
                    <Button small variant="secondary" title={past || q.superseded_by ? 'View' : 'Edit'} onPress={() => router.push({ pathname: '/supplier-quotes/quote', params: { pkg: pkg.id, id: q.id } })} />
                    {!fixed ? <Button small variant="secondary" title="Revised / discounted quote" onPress={() => revise(q)} /> : null}
                    {past && !closed && !q.superseded_by ? <Button small variant="secondary" title="Carry into Post Bid" onPress={() => carry(q)} /> : null}
                    {past && q.superseded_by ? <Pill label="Carried into Post Bid" tone={colors.blue} /> : null}
                    {!past ? <Button small variant="ghost" title="Delete" onPress={() => del(q)} /> : null}
                  </Row>
                </View>
              ))}
            </Row>
          </Card>
        </>
      )}
      {allChains.length ? (
        <Section title="How each supplier came down – every version">
          {allChains.map((c) => <Versions key={c[0].id} chain={c} name={sup(c[0])} items={items} />)}
        </Section>
      ) : null}
      {chosen || preChoice ? (
        <Section title="Choice">
          <Card>
            {chosen ? (
              <>
                <KeyValue label={stage === 'post_bid' ? 'Post Bid supplier' : 'Supplier'} value={sup(chosen)} />
                <KeyValue label="Reason" value={pkg.selection_reason ?? '—'} wide />
                <KeyValue label="Chosen by" value={`${people[pkg.selected_by ?? '']?.full_name ?? '—'} · ${fmtDate(pkg.selected_at)}`} />
              </>
            ) : null}
            {preChoice ? <KeyValue label="Chosen at Pre Bid" value={`${sup(preChoice)}${pkg.pre_bid_reason ? ` – ${pkg.pre_bid_reason}` : ''}`} wide /> : null}
          </Card>
        </Section>
      ) : null}
      {pkg.notes ? <Card><Muted>{pkg.notes}</Muted></Card> : null}
      <Muted>{'Green = lowest on the row. Commissioning and handover payments are taken 30 and 60 days after delivery; with no lead time given, 8 weeks is assumed.'}</Muted>
      <Pill label="Supplier prices: Operations, GM / DGM and people the GM / DGM allows" tone={colors.grey} />
    </Screen>
  );
}

/** One supplier's versions side by side: every line's rate in each version, the change from the version before, discounts, totals and what changed */
function Versions({ chain, name, items }: { chain: SqQuote[]; name: string; items: SqItem[] }) {
  const tot = chain.map(quoteTotals);
  const rows: CRow[] = compareRows(chain, items).map((r) => ({
    key: r.key, kind: 'line', label: r.label, sub: r.sub, href: r.item_id ? `/supplier-quotes/item/${r.item_id}` : undefined,
    cells: r.cells.map((c, i) => {
      if (!c) return { t: '—', sub: 'not in this version', tone: 'warn' };
      if (c.included) return { t: 'included' };
      const p = i ? r.cells[i - 1]?.unit : null, d = p && c.unit != null ? ((c.unit - p) / p) * 100 : null;
      return { t: lkr0(c.unit), sub: d != null && Math.abs(d) >= 0.05 ? `${d > 0 ? '+' : ''}${d.toFixed(1)} % · quoted ${c.written}` : `quoted ${c.written}`, tone: d != null && d <= -0.05 ? 'good' : d != null && d >= 0.05 ? 'bad' : undefined };
    }),
  }));
  if (chain.some((q) => q.discount_pct || q.discount_amt))
    rows.push({ key: 'disc', kind: 'row', label: 'Discount on the whole quote', cells: chain.map((q) => ({ t: [q.discount_pct ? `${q.discount_pct} %` : '', q.discount_amt ? `${q.currency} ${lkr0(q.discount_amt)}` : ''].filter(Boolean).join(' + ') || '–' })) });
  rows.push({ key: 'tot', kind: 'total', label: 'Comparable total (LKR)', cells: chain.map((q, i) => {
    const d = i && tot[0].total ? ((tot[i].total - tot[0].total) / tot[0].total) * 100 : null;
    return { t: lkrM(tot[i].total), sub: d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)} % from the first offer` : 'first offer', tone: d != null && d < 0 ? 'good' : d != null && d > 0 ? 'bad' : undefined };
  }) });
  rows.push({ key: 'lead', kind: 'row', label: 'Lead time', cells: chain.map((q) => ({ t: q.lead_weeks != null ? `${q.lead_weeks} weeks` : '—' })) });
  rows.push({ key: 'pay', kind: 'row', label: 'Payment terms', cells: chain.map((q) => ({ t: payText(q) })) });
  rows.push({ key: 'note', kind: 'row', label: 'What changed', cells: chain.map((q) => ({ t: q.revision ? q.revision_note ?? '—' : 'First quote' })) });
  const columns: Column<CRow>[] = [
    { h: name, w: 230, grow: true, v: (r) => <View><Text style={{ fontWeight: r.kind === 'total' ? '800' : '600', color: colors.ink }}>{r.label}</Text>{r.sub ? <Muted>{r.sub}</Muted> : null}</View> },
    ...chain.map((q, i): Column<CRow> => ({
      h: `${revLabel(q)} · ${STAGE_LABEL[q.bid_stage ?? 'pre_bid']} · ${q.quote_date ? fmtDate(q.quote_date) : fmtDate(q.created_at)}${q.superseded_by ? '' : ' · latest'}`, w: 190,
      v: (r) => {
        const c = r.cells[i];
        if (!c) return '';
        const t = c.tone ? TONE[c.tone] : null;
        return <View style={{ backgroundColor: t?.bg, borderRadius: 6, padding: t ? 4 : 0, alignSelf: 'stretch' }}><Text style={{ color: t?.fg ?? colors.ink, fontWeight: r.kind === 'total' ? '800' : '500' }}>{c.t}</Text>{c.sub ? <Muted>{c.sub}</Muted> : null}</View>;
      },
    })),
  ];
  return (
    <View style={{ gap: 4, marginBottom: 12 }}>
      <Muted>{chain.length > 1 ? `${name}: ${chain.length} versions – ${lkrM(tot[0].total)} → ${lkrM(tot[tot.length - 1].total)} (${(((tot[tot.length - 1].total - tot[0].total) / (tot[0].total || 1)) * 100).toFixed(1)} %). Green = came down from the version before.` : `${name}: one version so far.`}</Muted>
      <DataTable rows={rows} keyOf={(r) => r.key} columns={columns} rowStyle={(r) => (r.kind === 'total' ? { borderTopWidth: 2, borderTopColor: colors.ink } : undefined)} />
    </View>
  );
}
