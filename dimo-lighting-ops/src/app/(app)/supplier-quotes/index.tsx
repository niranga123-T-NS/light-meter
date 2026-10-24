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
import { lkr0, lkrM, loadRefs, quoteTotals, type SqItem, type SqPackage, type SqQuote, type Supplier } from '@/lib/supplierQuotes';
import { rpc, supabase } from '@/lib/supabase';

type Tab = 'packages' | 'rates' | 'suppliers' | 'access';
const STATUS: Record<SqPackage['status'], { label: string; tone: string }> = {
  open: { label: 'Comparing', tone: colors.blue },
  selected: { label: 'Supplier chosen', tone: colors.green },
  closed: { label: 'Closed', tone: colors.grey },
  cancelled: { label: 'Cancelled', tone: colors.grey },
};

/** Supplier quotes: packages with their quotes and comparison, the rate library, the suppliers, and who has access (GM / DGM). */
export default function SupplierQuotes() {
  const { sqAccess, realRole } = useAuth();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const tab: Tab = params.tab && ['packages', 'rates', 'suppliers', 'access'].includes(params.tab) ? params.tab : 'packages';
  if (!sqAccess)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Supplier quotes' }} />
        <Notice tone={colors.amber}>Supplier quotes are open to the Operations Executive, the GM / DGM and the people the GM / DGM allows.</Notice>
      </Screen>
    );
  const opts: { value: Tab; label: string }[] = [
    { value: 'packages', label: 'Packages' },
    { value: 'rates', label: 'Rate library' },
    { value: 'suppliers', label: 'Suppliers' },
    ...(realRole === 'gm' ? [{ value: 'access' as Tab, label: 'Access' }] : []),
  ];
  return (
    <Screen maxWidth={1240}>
      <Stack.Screen options={{ title: 'Supplier quotes' }} />
      <Segmented value={tab} onChange={(v) => router.setParams({ tab: v === 'packages' ? undefined : v })} options={opts} wrap />
      {tab === 'packages' ? <Packages /> : tab === 'rates' ? <RateLibrary /> : tab === 'suppliers' ? <Suppliers /> : <Access />}
      <Muted>Uploaded quote files are only read on this device and never stored – only the values you check and save are kept.</Muted>
    </Screen>
  );
}

// ---------------------------------------------------------------- packages
function Packages() {
  const dialog = useDialog();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const { data, error, reload } = useLoad(async () => {
    const [p, q, s] = await Promise.all([
      supabase.from('sq_packages').select('*').order('updated_at', { ascending: false }).limit(300),
      supabase.from('sq_quotes').select('id, package_id, supplier_id, valid_until, fx_rate, freight_pct, currency, lead_weeks, lines:sq_quote_lines(qty, rate, included), exclusions:sq_quote_exclusions(add_lkr)'),
      supabase.from('sq_settings').select('cost_of_money_pct').maybeSingle(),
    ]);
    const err = p.error ?? q.error;
    if (err) throw new Error(err.message);
    const sups = await supabase.from('sq_suppliers').select('id, name');
    return { pkgs: (p.data ?? []) as SqPackage[], quotes: (q.data ?? []) as unknown as SqQuote[], sups: (sups.data ?? []) as Supplier[], cost: Number(s.data?.cost_of_money_pct ?? 12) };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const today = todayISO();
  const rows = data.pkgs
    .filter((p) => show === 'all' || p.status === 'open' || p.status === 'selected')
    .map((p) => {
      const qs = data.quotes.filter((q) => q.package_id === p.id).map((q) => ({ q, t: quoteTotals({ ...q, payments: [], lines: q.lines.map((l) => ({ ...l, rate: l.rate == null ? null : Number(l.rate), qty: l.qty == null ? null : Number(l.qty) })), exclusions: q.exclusions.map((x) => ({ ...x, add_lkr: Number(x.add_lkr) })), fx_rate: Number(q.fx_rate), freight_pct: Number(q.freight_pct) } as SqQuote).total }));
      const low = qs.length ? qs.reduce((a, b) => (b.t < a.t ? b : a)) : null;
      const sel = qs.find((x) => x.q.id === p.selected_quote_id);
      const expiring = qs.filter((x) => x.q.valid_until && ((p.our_validity && x.q.valid_until < p.our_validity) || x.q.valid_until < today));
      return { p, n: qs.length, low, sel, expiring };
    });
  const supName = (id?: string) => data.sups.find((s) => s.id === id)?.name ?? '—';
  const add = async () => {
    const r = await dialog.prompt({
      title: 'New package',
      message: 'What is being bought or subcontracted for a job. Add the quotes to it and compare them.',
      fields: [
        { key: 'title', label: 'Package', required: true, hint: 'e.g. LED floodlights, Lattice masts, Mast foundations' },
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: 'supply', options: [{ value: 'supply', label: 'Supply' }, { value: 'subcontract', label: 'Subcontract' }] },
        { key: 'project', label: 'Project / client', hint: 'As you know it – e.g. the stadium name' },
        { key: 'job', label: 'Job or inquiry reference', hint: 'e.g. EST-2026-0142, PRJ-0087' },
        { key: 'valid', label: 'Our quotation is valid until', type: 'date', hint: 'Warns when a supplier\'s quote ends before it' },
        { key: 'weeks', label: 'Needed on site within (weeks)', hint: 'Lead times longer than this are flagged' },
      ],
      confirmLabel: 'Create',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { data: p, error: e } = await supabase.from('sq_packages')
        .insert({ title: r.title.trim(), kind: r.kind, project_name: r.project?.trim() || null, job_ref: r.job?.trim() || null, our_validity: r.valid || null, needed_weeks: Number(r.weeks) > 0 ? Number(r.weeks) : null })
        .select('id').single();
      if (e) throw new Error(e.message);
      router.push(`/supplier-quotes/${p.id}`);
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
        <Button title="New package" icon="＋" onPress={add} />
        <Segmented value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
        <Button variant="ghost" small title={`Cost of money ${data.cost} % a year`} onPress={setCost} />
      </Row>
      {rows.some((r) => r.expiring.length) ? (
        <Notice tone={colors.amber}>{`${rows.filter((r) => r.expiring.length).length} package(s) have a supplier quote that has ended or ends before our quotation – ask the supplier to extend it.`}</Notice>
      ) : null}
      <DataTable
        rows={rows}
        keyOf={(r) => r.p.id}
        onPress={(r) => router.push(`/supplier-quotes/${r.p.id}`)}
        emptyTitle="No packages yet – create one and add the supplier quotes"
        edge={(r) => (r.expiring.length ? colors.amber : undefined)}
        columns={[
          { h: 'Package', w: 230, grow: true, v: (r) => <View><Text style={{ fontWeight: '600', color: colors.ink }}>{r.p.title}</Text><Muted>{[r.p.code, r.p.project_name, r.p.job_ref].filter(Boolean).join(' · ')}</Muted></View> },
          { h: 'Type', w: 100, v: (r) => (r.p.kind === 'supply' ? 'Supply' : 'Subcontract') },
          { h: 'Quotes', w: 70, right: true, v: (r) => String(r.n) },
          { h: 'Lowest (comparable)', w: 170, v: (r) => (r.low ? <View><Text style={{ color: colors.ink }}>{`LKR ${lkrM(r.low.t)}`}</Text><Muted>{supName(r.low.q.supplier_id)}</Muted></View> : '—') },
          { h: 'Chosen', w: 170, v: (r) => (r.sel ? supName(r.sel.q.supplier_id) : '—') },
          { h: 'Status', w: 140, v: (r) => <Pill label={r.expiring.length ? 'Quote ending' : STATUS[r.p.status].label} tone={r.expiring.length ? colors.amber : STATUS[r.p.status].tone} /> },
          { h: 'Updated', w: 100, v: (r) => fmtDate(r.p.updated_at) },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- rate library
function RateLibrary() {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(async () => {
    const refs = await loadRefs();
    const { data: ls, error: e } = await supabase.from('sq_quote_lines').select('item_id, rate, included, quote:sq_quotes(quote_date, created_at, fx_rate, freight_pct, supplier_id)').not('item_id', 'is', null).limit(5000);
    if (e) throw new Error(e.message);
    return { ...refs, lines: (ls ?? []) as unknown as { item_id: string; rate: number | null; included: boolean; quote: { quote_date: string | null; created_at: string; fx_rate: number; freight_pct: number; supplier_id: string } }[] };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const stats = (it: SqItem) => {
    const ps = data.lines.filter((l) => l.item_id === it.id && !l.included && l.rate != null)
      .map((l) => ({ v: Number(l.rate) * Number(l.quote.fx_rate) * (1 + Number(l.quote.freight_pct) / 100), d: l.quote.quote_date ?? l.quote.created_at.slice(0, 10), s: l.quote.supplier_id }))
      .sort((a, b) => b.d.localeCompare(a.d));
    const sorted = ps.map((p) => p.v).sort((a, b) => a - b);
    return { n: ps.length, latest: ps[0], median: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null, low: sorted[0] ?? null, sups: new Set(ps.map((p) => p.s)).size };
  };
  const items = data.items.filter((i) => !q.trim() || `${i.code} ${i.name} ${i.sap_code ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <Field label="Search items" value={q} onChangeText={setQ} placeholder="Code, name or SAP code" />
      <Muted>{'Every rate from every quote, chosen or not, in LKR delivered (freight added) at the quote\'s exchange rate. Tap an item for its full history.'}</Muted>
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
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- suppliers
function Suppliers() {
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: s, error: e } = await supabase.from('sq_suppliers').select('*').order('name');
    if (e) throw new Error(e.message);
    const { data: q } = await supabase.from('sq_quotes').select('id, supplier_id');
    const { data: sel } = await supabase.from('sq_packages').select('selected_quote_id').not('selected_quote_id', 'is', null);
    return { sups: (s ?? []) as Supplier[], quotes: (q ?? []) as { id: string; supplier_id: string }[], chosen: new Set((sel ?? []).map((x) => x.selected_quote_id as string)) };
  }, []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const edit = async (s?: Supplier) => {
    const r = await dialog.prompt({
      title: s ? 'Edit supplier' : 'New supplier / subcontractor',
      fields: [
        { key: 'name', label: 'Name', required: true, initial: s?.name },
        { key: 'kind', label: 'Supplies', type: 'select', required: true, initial: s?.kind ?? 'supply', options: [{ value: 'supply', label: 'Materials (supplier)' }, { value: 'subcontract', label: 'Work (subcontractor)' }, { value: 'both', label: 'Both' }] },
        { key: 'trades', label: 'What they supply', initial: s?.trades ?? '', hint: 'e.g. floodlights, masts, civil works' },
        { key: 'contact', label: 'Contact person', initial: s?.contact_name ?? '' },
        { key: 'phone', label: 'Phone', initial: s?.phone ?? '' },
        { key: 'email', label: 'Email', initial: s?.email ?? '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: s?.notes ?? '' },
        ...(s ? [{ key: 'active', label: 'Status', type: 'select' as const, initial: s.active ? 'yes' : 'no', options: [{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Not used any more' }] }] : []),
      ],
    });
    if (!r) return;
    const row = { name: r.name.trim(), kind: r.kind, trades: r.trades?.trim() || null, contact_name: r.contact?.trim() || null, phone: r.phone?.trim() || null, email: r.email?.trim() || null, notes: r.notes?.trim() || null, ...(s ? { active: r.active !== 'no' } : {}) };
    await dialog.run(async () => {
      const { error: e } = s ? await supabase.from('sq_suppliers').update(row).eq('id', s.id) : await supabase.from('sq_suppliers').insert(row);
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'A supplier with this name is already in the list' : e.message);
      reload();
    }, 'Saved');
  };
  return (
    <>
      <Row><Button title="New supplier" icon="＋" onPress={() => edit()} /></Row>
      <DataTable
        rows={data.sups}
        keyOf={(s) => s.id}
        onPress={edit}
        emptyTitle="No suppliers yet"
        rowStyle={(s) => (s.active ? undefined : { opacity: 0.5 })}
        columns={[
          { h: 'Supplier / subcontractor', w: 240, grow: true, v: (s) => <View><Text style={{ fontWeight: '600', color: colors.ink }}>{s.name}</Text><Muted>{s.trades ?? ''}</Muted></View> },
          { h: 'Type', w: 110, v: (s) => ({ supply: 'Supplier', subcontract: 'Subcontractor', both: 'Both' })[s.kind] },
          { h: 'Contact', w: 200, v: (s) => [s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || '—' },
          { h: 'Quotes', w: 70, right: true, v: (s) => String(data.quotes.filter((q) => q.supplier_id === s.id).length) },
          { h: 'Chosen', w: 70, right: true, v: (s) => String(data.quotes.filter((q) => q.supplier_id === s.id && data.chosen.has(q.id)).length) },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- access (GM / DGM)
type Grant = { id: string; user_id: string; reason: string; granted_by: string; granted_at: string; cancelled_at: string | null; cancelled_by: string | null; cancel_reason: string | null };
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
  const ops = Object.values(people).filter((p) => p.active && (p.role === 'operations_exec' || p.role === 'gm'));
  const allow = async () => {
    const r = await dialog.prompt({
      title: 'Allow a person',
      message: 'They can see supplier quotes and add, upload, enter and edit them – until you cancel it.',
      fields: [
        { key: 'u', label: 'Person', type: 'select', required: true, searchable: true, options: Object.values(people)
            .filter((p) => p.active && !['gm', 'operations_exec', 'guest', 'sub_supervisor'].includes(p.role) && !open.some((g) => g.user_id === p.id))
            .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((p) => ({ value: p.id, label: p.full_name, hint: ROLE_SHORT[p.role] })) },
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Allow',
    });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_grant', { p_user: r.u, p_reason: r.reason }); reload(); }, 'Access given – the person is told');
  };
  const cancel = async (g: Grant) => {
    const r = await dialog.prompt({ title: `End ${name(g.user_id)}'s access?`, fields: [{ key: 'reason', label: 'Reason (optional)', type: 'multiline' }], confirmLabel: 'End access', danger: true });
    if (!r) return;
    await dialog.run(async () => { await rpc('sq_revoke', { p_id: g.id, p_reason: r.reason || null }); reload(); }, 'Access ended – the person is told');
  };
  return (
    <>
      <Notice>The Operations Executive and the GM / DGM always see supplier quotes. Anyone else needs your permission, which lasts until you cancel it.</Notice>
      <Row><Button title="Allow a person" icon="＋" onPress={allow} /></Row>
      <Section title="Always">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {ops.map((p) => <ListRow key={p.id} title={p.full_name} subtitle={ROLE_SHORT[p.role]} />)}
        </Card>
      </Section>
      <Section title={`Allowed by you (${open.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {open.length ? open.map((g) => (
            <ListRow key={g.id} title={name(g.user_id)} subtitle={`${people[g.user_id] ? ROLE_SHORT[people[g.user_id].role] : ''} · since ${fmtDate(g.granted_at)} · ${g.reason}`} right={<Button small variant="secondary" title="End access" onPress={() => cancel(g)} />} />
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
