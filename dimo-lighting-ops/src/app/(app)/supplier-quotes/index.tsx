import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Field, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { exportExcel, exportPdf, type Column as XCol } from '@/lib/export';
import { discFactor, jobField, jobSource, KIND_LABEL, lkr0, lkrM, loadJobs, loadRefs, loadSystemSuppliers, originText, quoteTotals, supplierFields, supplierRow, type SqItem, type SqJob, type SqPackage, type SqQuote, type Supplier, type SysSupplier } from '@/lib/supplierQuotes';
import { type SqProject } from '@/lib/sqAnalysis';
import { rpc, supabase } from '@/lib/supabase';

type Tab = 'projects' | 'rates' | 'suppliers' | 'access';

/** Supplier quotes: projects with their packages, quotes and comparison, the rate library, the suppliers, and who has access (DGM). */
export default function SupplierQuotes() {
  const { sqAccess, realRole, sqReports } = useAuth();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const tab: Tab = params.tab && ['projects', 'rates', 'suppliers', 'access'].includes(params.tab) ? params.tab : 'projects';
  if (!sqAccess)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Supplier quotes' }} />
        <Notice tone={colors.amber}>Supplier quotes are open to the Operations Executive, the DGM and the people the DGM allows.</Notice>
      </Screen>
    );
  const opts: { value: Tab; label: string }[] = [
    { value: 'projects', label: 'Projects' },
    { value: 'rates', label: 'Rate library' },
    { value: 'suppliers', label: 'Suppliers & manufacturers' },
    ...(realRole === 'gm' ? [{ value: 'access' as Tab, label: 'Access' }] : []),
  ];
  return (
    <Screen maxWidth={1240}>
      <Stack.Screen options={{ title: 'Supplier quotes' }} />
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <View style={{ flexGrow: 1 }}><Segmented value={tab} onChange={(v) => router.setParams({ tab: v === 'projects' ? undefined : v })} options={opts} wrap /></View>
        {sqReports ? <Button title="Supplier reports" icon="▤" onPress={() => router.push('/supplier-quotes/reports')} /> : null}
      </Row>
      {tab === 'projects' ? <Projects /> : tab === 'rates' ? <RateLibrary /> : tab === 'suppliers' ? <Suppliers /> : <Access />}
      <Muted>Uploaded quote files are only read on this device and never stored – only the values you check and save are kept.</Muted>
    </Screen>
  );
}

// ---------------------------------------------------------------- packages
function Projects() {
  const dialog = useDialog();
  const { profile, sqReports } = useAuth();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const { data, error, reload } = useLoad(async () => {
    const [j, p, q, s] = await Promise.all([
      supabase.from('sq_projects').select('*').order('updated_at', { ascending: false }).limit(500),
      supabase.from('sq_packages').select('*').limit(3000),
      supabase.from('sq_quotes').select('id, package_id, supplier_id, bid_stage, revision, valid_until, fx_rate, freight_pct, currency, lead_weeks, discount_pct, discount_amt, lines:sq_quote_lines(qty, rate, included), exclusions:sq_quote_exclusions(add_lkr)').is('superseded_by', null),
      supabase.from('sq_settings').select('cost_of_money_pct').maybeSingle(),
    ]);
    const err = j.error ?? p.error ?? q.error;
    if (err) throw new Error(err.message);
    return { projects: (j.data ?? []) as SqProject[], pkgs: (p.data ?? []) as SqPackage[], quotes: (q.data ?? []) as unknown as SqQuote[], cost: Number(s.data?.cost_of_money_pct ?? 12) };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const today = todayISO();
  const tot = (q: SqQuote) => quoteTotals({ ...q, payments: [], lines: q.lines.map((l) => ({ ...l, rate: l.rate == null ? null : Number(l.rate), qty: l.qty == null ? null : Number(l.qty) })), exclusions: q.exclusions.map((x) => ({ ...x, add_lkr: Number(x.add_lkr) })), fx_rate: Number(q.fx_rate), freight_pct: Number(q.freight_pct) } as SqQuote).total;
  const rows = data.projects
    .filter((j) => show === 'all' || j.status === 'open')
    .map((j) => {
      const pk = data.pkgs.filter((p) => p.project_id === j.id && p.status !== 'cancelled');
      let low = 0, chosen = 0, offers = 0, nChosen = 0;
      const expiring: string[] = [];
      for (const p of pk) {
        // each supplier's latest version at the package's stage
        const qs = data.quotes.filter((q) => q.package_id === p.id && (q.bid_stage ?? 'pre_bid') === (p.stage ?? 'pre_bid'));
        offers += qs.length;
        if (qs.length) low += Math.min(...qs.map(tot));
        const c = qs.find((q) => q.id === p.selected_quote_id);
        if (c) { chosen += tot(c); nChosen++; }
        if (qs.some((q) => q.valid_until && (((p.stage ?? 'pre_bid') === 'pre_bid' && p.our_validity && q.valid_until < p.our_validity) || q.valid_until < today))) expiring.push(p.code);
      }
      return { j, pk, low, chosen, offers, nChosen, expiring };
    });
  const projCols: XCol<(typeof rows)[number]>[] = [
    { header: 'Code', value: (r) => r.j.code }, { header: 'Project', value: (r) => r.j.name, width: 36 }, { header: 'Client', value: (r) => r.j.client ?? '' }, { header: 'Reference', value: (r) => r.j.job_ref ?? '' },
    { header: 'Packages', value: (r) => r.pk.length, align: 'right' }, { header: 'Chosen', value: (r) => r.nChosen, align: 'right' }, { header: 'Offers', value: (r) => r.offers, align: 'right' },
    { header: 'Lowest now LKR M', value: (r) => (r.offers ? lkrM(r.low) : ''), align: 'right' }, { header: 'Chosen LKR M', value: (r) => (r.nChosen ? lkrM(r.chosen) : ''), align: 'right' },
    { header: 'Status', value: (r) => (r.expiring.length ? 'Quote ending' : r.j.status) }, { header: 'Updated', value: (r) => fmtDate(r.j.updated_at) },
  ];
  const projMeta = () => ({ key: 'supplier_projects', title: 'Supplier quotes – projects', filters: show === 'open' ? 'Open projects' : 'All projects', currencyNote: 'LKR delivered – freight, discounts and priced-back exclusions included', generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true });
  const add = async () => {
    const jobs = await loadJobs().catch(() => [] as SqJob[]);
    const r = await dialog.prompt({
      title: 'New project',
      message: 'The job the supplier quotes are for. Add its packages next (e.g. floodlights, masts, civil works).',
      fields: [
        { ...jobField(jobs), fill: (v: string): Record<string, string> => { const x = jobs.find((y) => `${y.kind}:${y.id}` === v); return x ? { name: x.project_name ?? '', client: x.client ?? '', job: x.ref ?? '' } : {}; } },
        { key: 'name', label: 'Project', required: true, hint: 'e.g. Kalutara road lighting' },
        { key: 'client', label: 'Client', hint: 'e.g. Road Development Authority' },
        { key: 'job', label: 'Job or inquiry reference', hint: 'e.g. LS-000186, EST-2026-0142' },
        { key: 'valid', label: 'Our quotation is valid until', type: 'date', hint: 'Warns when a supplier\'s quote ends before it' },
      ],
      confirmLabel: 'Create',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { data: j, error: e } = await supabase.from('sq_projects')
        .insert({ name: r.name.trim(), client: r.client?.trim() || null, job_ref: r.job?.trim() || null, ...jobSource(r.src), our_validity: r.valid || null })
        .select('id').single();
      if (e) throw new Error(e.message);
      router.push(`/supplier-quotes/project/${j.id}`);
    });
  };
  const setCost = async () => {
    const r = await dialog.prompt({ title: 'Cost of money', message: 'Used to show what paying early (advances, LC) costs and what credit saves. Shown on the comparison, never added to the price.', fields: [{ key: 'v', label: '% a year', required: true, initial: String(data.cost) }] });
    if (!r) return;
    const v = Number(r.v);
    if (!(v >= 0 && v <= 100)) return dialog.toast('Enter a % between 0 and 100', 'error');
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_settings').update({ cost_of_money_pct: v, updated_at: new Date().toISOString() }).eq('id', 1);
      if (e) throw new Error(e.message);
      reload();
    }, 'Saved');
  };
  return (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Button title="New project" icon="＋" onPress={add} />
        <Segmented value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
        {sqReports ? <Button variant="secondary" small title="Overall summary – every project and package" onPress={() => router.push({ pathname: '/supplier-quotes/reports', params: { r: 'projects' } })} /> : null}
        <Button variant="ghost" small title={`Cost of money ${data.cost} % a year`} onPress={setCost} />
        <Button variant="secondary" small title="Export PDF" onPress={() => dialog.run(() => exportPdf(projMeta(), projCols, [{ rows }]))} />
        <Button variant="secondary" small title="Excel" onPress={() => dialog.run(() => exportExcel(projMeta(), projCols, [{ rows }]))} />
      </Row>
      {rows.some((r) => r.expiring.length) ? (
        <Notice tone={colors.amber}>{`${rows.filter((r) => r.expiring.length).length} project(s) have a supplier quote that has ended, or (at Pre Bid) ends before our quotation – ask the supplier to extend it.`}</Notice>
      ) : null}
      <DataTable
        rows={rows}
        keyOf={(r) => r.j.id}
        onPress={(r) => router.push(`/supplier-quotes/project/${r.j.id}`)}
        emptyTitle="No projects yet – create one, then add its packages and the supplier quotes"
        edge={(r) => (r.expiring.length ? colors.amber : undefined)}
        columns={[
          { h: 'Project', w: 240, grow: true, v: (r) => <View><Text style={{ fontWeight: '600', color: colors.ink }}>{r.j.name}</Text><Muted>{[r.j.code, r.j.client, r.j.job_ref].filter(Boolean).join(' · ')}</Muted></View> },
          { h: 'Packages', w: 90, right: true, v: (r) => <View style={{ alignItems: 'flex-end' }}><Text style={{ color: colors.ink }}>{String(r.pk.length)}</Text><Muted>{`${r.nChosen} chosen`}</Muted></View> },
          { h: 'Offers', w: 70, right: true, v: (r) => String(r.offers) },
          { h: 'Lowest now', w: 120, right: true, v: (r) => (r.offers ? `LKR ${lkrM(r.low)}` : '—') },
          { h: 'Chosen', w: 120, right: true, v: (r) => (r.nChosen ? `LKR ${lkrM(r.chosen)}` : '—') },
          { h: 'Status', w: 130, v: (r) => <Pill label={r.expiring.length ? 'Quote ending' : r.j.status === 'open' ? 'Open' : r.j.status === 'closed' ? 'Closed' : 'Cancelled'} tone={r.expiring.length ? colors.amber : r.j.status === 'open' ? colors.blue : colors.grey} /> },
          { h: 'Updated', w: 100, v: (r) => fmtDate(r.j.updated_at) },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- rate library
function RateLibrary() {
  const [q, setQ] = useState('');
  const dialog = useDialog();
  const { profile } = useAuth();
  const { data, error } = useLoad(async () => {
    const refs = await loadRefs();
    const { data: ls, error: e } = await supabase.from('sq_quote_lines').select('item_id, rate, included, quote:sq_quotes(id, first_id, revision, superseded_by, quote_date, created_at, fx_rate, freight_pct, supplier_id, discount_pct, discount_amt, lines:sq_quote_lines(qty, rate, included))').not('item_id', 'is', null).limit(5000);
    if (e) throw new Error(e.message);
    type QL = { item_id: string; rate: number | null; included: boolean; quote: { id: string; first_id: string | null; revision: number; superseded_by: string | null; quote_date: string | null; created_at: string; fx_rate: number; freight_pct: number; supplier_id: string; discount_pct: number; discount_amt: number; lines: { qty: number | null; rate: number | null; included: boolean }[] } };
    return { ...refs, lines: (ls ?? []) as unknown as QL[] };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const stats = (it: SqItem) => {
    const all = data.lines.filter((l) => l.item_id === it.id && !l.included && l.rate != null)
      .map((l) => ({ v: Number(l.rate) * Number(l.quote.fx_rate) * (1 + Number(l.quote.freight_pct) / 100) * discFactor(l.quote), d: l.quote.quote_date ?? l.quote.created_at.slice(0, 10), s: l.quote.supplier_id, q: l.quote }));
    // prices are each supplier's latest version; the drop from the first offer to the latest shows how far suppliers come down
    const ps = all.filter((p) => !p.q.superseded_by).sort((a, b) => b.d.localeCompare(a.d));
    const drops = ps.filter((p) => p.q.revision > 0).map((p) => { const f = all.find((x) => x.q.id === p.q.first_id); return f ? ((p.v - f.v) / f.v) * 100 : null; }).filter((x): x is number => x != null);
    const sorted = ps.map((p) => p.v).sort((a, b) => a - b);
    return { n: ps.length, versions: all.length, latest: ps[0], median: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null, low: sorted[0] ?? null, sups: new Set(ps.map((p) => p.s)).size, drop: drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null };
  };
  type RR = { it: SqItem; s: ReturnType<typeof stats> };
  const rateCols: XCol<RR>[] = [
    { header: 'Code', value: (r) => r.it.code }, { header: 'Item', value: (r) => r.it.name, width: 40 }, { header: 'SAP', value: (r) => r.it.sap_code ?? '' }, { header: 'Unit', value: (r) => r.it.unit ?? '' },
    { header: 'Quotes', value: (r) => r.s.n, align: 'right' }, { header: 'Suppliers', value: (r) => r.s.sups, align: 'right' },
    { header: 'Latest LKR', value: (r) => (r.s.latest ? lkr0(r.s.latest.v) : ''), align: 'right' }, { header: 'Latest date', value: (r) => (r.s.latest ? fmtDate(r.s.latest.d) : '') },
    { header: 'Median LKR', value: (r) => lkr0(r.s.median), align: 'right' }, { header: 'Lowest LKR', value: (r) => lkr0(r.s.low), align: 'right' },
    { header: 'Came down', value: (r) => (r.s.drop != null ? `${r.s.drop.toFixed(1)} %` : ''), align: 'right' },
  ];
  const rateMeta = () => ({ key: 'supplier_rates', title: 'Rate library – supplier prices per item', filters: q.trim() ? `Search: ${q.trim()}` : 'All items', currencyNote: 'LKR per unit delivered – exchange rate of the quote, freight and discount included', generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true });
  const items = data.items.filter((i) => !q.trim() || `${i.code} ${i.name} ${i.sap_code ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
        <View style={{ flexGrow: 1, minWidth: 240 }}><Field label="Search items" value={q} onChangeText={setQ} placeholder="Code, name or SAP code" /></View>
        <Button variant="secondary" small title="Export PDF" onPress={() => dialog.run(() => exportPdf(rateMeta(), rateCols, [{ rows: items.map((it) => ({ it, s: stats(it) })) }]))} />
        <Button variant="secondary" small title="Excel" onPress={() => dialog.run(() => exportExcel(rateMeta(), rateCols, [{ rows: items.map((it) => ({ it, s: stats(it) })) }]))} />
      </Row>
      <Muted>{'Each supplier\'s latest price on every job, chosen or not, in LKR delivered (freight and discount included) at the quote\'s exchange rate. “Came down” is the average drop from the first offer to the latest version. Tap an item for every version on every job.'}</Muted>
      <DataTable
        rows={items.map((it) => ({ it, s: stats(it) }))}
        keyOf={(r) => r.it.id}
        onPress={(r) => router.push(`/supplier-quotes/item/${r.it.id}`)}
        emptyTitle="No items yet – items are added when quote lines are matched"
        columns={[
          { h: 'Item', w: 240, grow: true, v: (r) => <View><Text style={{ fontWeight: '600', color: colors.ink }}>{r.it.name}</Text><Muted>{[r.it.code, r.it.sap_code && `SAP ${r.it.sap_code}`, r.it.unit].filter(Boolean).join(' · ')}</Muted></View> },
          { h: 'Quotes', w: 70, right: true, v: (r) => String(r.s.n) },
          { h: 'Suppliers', w: 80, right: true, v: (r) => String(r.s.sups) },
          { h: 'Latest', w: 130, right: true, v: (r) => (r.s.latest ? <View style={{ alignItems: 'flex-end' }}><Text style={{ color: colors.ink }}>{lkr0(r.s.latest.v)}</Text><Muted>{fmtDate(r.s.latest.d)}</Muted></View> : '—') },
          { h: 'Typical (median)', w: 130, right: true, v: (r) => lkr0(r.s.median) },
          { h: 'Lowest', w: 120, right: true, v: (r) => lkr0(r.s.low) },
          { h: 'Came down (avg.)', w: 130, right: true, v: (r) => (r.s.drop != null ? <View style={{ alignItems: 'flex-end' }}><Text style={{ color: r.s.drop < 0 ? colors.green : colors.ink }}>{`${r.s.drop.toFixed(1)} %`}</Text><Muted>{`${r.s.versions} versions`}</Muted></View> : '—') },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- suppliers
function Suppliers() {
  const dialog = useDialog();
  const { sqReports } = useAuth();
  const { data, error, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('sq_suppliers').select('*').order('name');
    if (e) throw new Error(e.message);
    const { data: q } = await supabase.from('sq_quotes').select('id, supplier_id');
    const { data: sel } = await supabase.from('sq_packages').select('selected_quote_id').not('selected_quote_id', 'is', null);
    return { sups: (s ?? []) as Supplier[], quotes: (q ?? []) as { id: string; supplier_id: string }[], chosen: new Set((sel ?? []).map((x) => x.selected_quote_id as string)) };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const edit = async (s?: Supplier, from?: SysSupplier) => {
    const r = await dialog.prompt({
      title: s ? 'Edit supplier' : from ? `Add ${from.name}` : 'New supplier / manufacturer / subcontractor',
      message: from ? `From ${from.source}. Check the details before adding.` : undefined,
      fields: [
        ...supplierFields(s ?? from),
        { key: 'notes', label: 'Notes', type: 'multiline', initial: s?.notes ?? '' },
        ...(s ? [{ key: 'active', label: 'Status', type: 'select' as const, initial: s.active ? 'yes' : 'no', options: [{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Not used any more' }] }] : []),
      ],
    });
    if (!r) return;
    const row = { ...supplierRow(r), notes: r.notes?.trim() || null, ...(s ? { active: r.active !== 'no' } : {}) };
    await dialog.run(async () => {
      const { error: e } = s ? await supabase.from('sq_suppliers').update(row).eq('id', s.id) : await supabase.from('sq_suppliers').insert(row);
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'A supplier with this name is already in the list' : e.message);
      reload();
    }, 'Saved');
  };
  // suppliers and manufacturers already named in manufacturers, brands, foreign and local orders or material requests
  const fromSystem = async () => {
    const sys = await loadSystemSuppliers().catch(() => [] as SysSupplier[]);
    if (!sys.length) return dialog.alert('Nothing new to add', 'Every supplier and manufacturer named in the system is already in the list.');
    const r = await dialog.prompt({
      title: 'Add from system records',
      message: 'Names from manufacturers, brands, foreign and local orders and material requests that are not in the supplier list yet.',
      fields: [{ key: 'i', label: 'Supplier or manufacturer', type: 'select', searchable: true, required: true, options: sys.map((x, i) => ({ value: String(i), label: `${x.name} · ${x.source} · ${x.origin === 'foreign' ? 'Foreign' : 'Local'}` })) }],
      confirmLabel: 'Next',
    });
    if (r?.i) await edit(undefined, sys[Number(r.i)]);
  };
  return (
    <>
      <Row wrap gap={8}>
        <Button title="New supplier / manufacturer" icon="＋" onPress={() => edit()} />
        <Button variant="secondary" title="Add from system records" onPress={fromSystem} />
      </Row>
      <DataTable
        rows={data.sups}
        keyOf={(s) => s.id}
        onPress={(s) => (sqReports ? router.push(`/supplier-quotes/supplier/${s.id}`) : edit(s))}
        emptyTitle="No suppliers yet"
        rowStyle={(s) => (s.active ? undefined : { opacity: 0.5 })}
        columns={[
          { h: 'Supplier / manufacturer / subcontractor', w: 240, grow: true, v: (s) => <View><Text style={{ fontWeight: '600', color: colors.ink }}>{s.name}</Text><Muted>{s.trades ?? ''}</Muted></View> },
          { h: 'Type', w: 150, v: (s) => <View><Text style={{ color: colors.ink }}>{KIND_LABEL[s.kind]}</Text><Muted>{originText(s)}</Muted></View> },
          { h: 'Contact', w: 200, v: (s) => [s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—' },
          { h: 'Quotes', w: 70, right: true, v: (s) => String(data.quotes.filter((q) => q.supplier_id === s.id).length) },
          { h: 'Chosen', w: 70, right: true, v: (s) => String(data.quotes.filter((q) => q.supplier_id === s.id && data.chosen.has(q.id)).length) },
          ...(sqReports ? [{ h: '', w: 80, v: (s: Supplier) => <Button small variant="ghost" title="Edit" onPress={() => edit(s)} /> }] : []),
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- access (DGM)
type Grant = { id: string; user_id: string; reason: string; reports_only?: boolean; granted_by: string; granted_at: string; cancelled_at: string | null; cancelled_by: string | null; cancel_reason: string | null };
function Access() {
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: g, error: e } = await supabase.from('sq_access_grants').select('*').order('granted_at', { ascending: false }).limit(300);
    if (e) throw new Error(e.message);
    return (g ?? []) as Grant[];
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const name = (id?: string | null) => (id ? people[id]?.full_name ?? '—' : '—');
  const open = data.filter((g) => !g.cancelled_at), past = data.filter((g) => g.cancelled_at);
  const ops = Object.values(people).filter((p) => p.active && (p.role === 'operations_exec' || p.role === 'gm' || p.role === 'sm_estimation'));
  const allow = async () => {
    const r = await dialog.prompt({
      title: 'Allow a person',
      message: 'Supplier quotes: they see the quotes and add, upload, enter and edit them. Reports only: they open the supplier reports and the project, package, item and supplier analyses, read only. Until you cancel it.',
      fields: [
        { key: 'kind', label: 'Access', type: 'select', required: true, initial: 'full', options: [{ value: 'full', label: 'Supplier quotes – see and edit' }, { value: 'reports', label: 'Supplier reports only – read only (e.g. estimators)' }] },
        { key: 'u', label: 'Person', type: 'select', required: true, searchable: true, options: Object.values(people)
            .filter((p) => p.active && !['gm', 'operations_exec', 'guest', 'sub_supervisor'].includes(p.role) && !open.some((g) => g.user_id === p.id))
            .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((p) => ({ value: p.id, label: p.full_name, hint: ROLE_SHORT[p.role] })) },
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Allow',
    });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_grant', { p_user: r.u, p_reason: r.reason, p_reports_only: r.kind === 'reports' }); reload(); }, 'Access given – the person is told');
  };
  const cancel = async (g: Grant) => {
    const r = await dialog.prompt({ title: `End ${name(g.user_id)}'s access?`, fields: [{ key: 'reason', label: 'Reason (optional)', type: 'multiline' }], confirmLabel: 'End access', danger: true });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_revoke', { p_id: g.id, p_reason: r.reason || null }); reload(); }, 'Access ended – the person is told');
  };
  return (
    <>
      <Notice>The Operations Executive and the DGM always see supplier quotes; the SM Estimation always opens the supplier reports (read only). Anyone else needs your permission – for the quotes, or for the reports only – which lasts until you cancel it.</Notice>
      <Row><Button title="Allow a person" icon="＋" onPress={allow} /></Row>
      <Section title="Always">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {ops.map((p) => <ListRow key={p.id} title={p.full_name} subtitle={`${ROLE_SHORT[p.role]}${p.role === 'sm_estimation' ? ' · reports only' : ''}`} />)}
        </Card>
      </Section>
      <Section title={`Allowed by you (${open.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {open.length ? open.map((g) => (
            <ListRow key={g.id} title={name(g.user_id)} subtitle={`${g.reports_only ? 'Reports only' : 'Supplier quotes'} · ${people[g.user_id] ? ROLE_SHORT[people[g.user_id].role] : ''} · since ${fmtDate(g.granted_at)} · ${g.reason}`} right={<Button small variant="secondary" title="End access" onPress={() => cancel(g)} />} />
          )) : <Empty title="Nobody else has access" />}
        </Card>
      </Section>
      {past.length ? (
        <Section title="Ended">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {past.map((g) => <ListRow key={g.id} title={name(g.user_id)} subtitle={`${fmtDate(g.granted_at)} – ${fmtDate(g.cancelled_at)} · ${g.reason}${g.cancel_reason ? ` · ended: ${g.cancel_reason}` : ''}`} />)}
          </Card>
        </Section>
      ) : null}
    </>
  );
}
