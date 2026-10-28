import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { BlinkTablet } from '@/components/WinUse';
import { Button, Card, colors, Empty, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Row, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

export type OpsStatus = 'pending' | 'ok' | 'revision' | 'on_hold';
export type SupplyPi = {
  id: string;
  seq: number;
  manufacturer: string;
  country: string | null;
  notes?: string | null;
  pi_no: string | null;
  pi_date?: string | null;
  pi_value: number | null;
  currency: string | null;
  submitted_at: string | null;
  revision?: number;
  ops_status: OpsStatus | null;
  ops_note: string | null;
  ops_at?: string | null;
};
export type SupplyOrder = {
  id: string;
  code: string;
  created_at: string;
  mfr_count: number;
  secured_id: string;
  project: string;
  customer: string | null;
  sales_person_id: string | null;
  order_value: number | null;
  submitted: number;
  pis: SupplyPi[];
};

/** Who works on supply orders: SM Estimation enters the PIs, Operations sets their status */
export const isSoEstimator = (r: string) => r === 'sm_estimation' || r === 'gm';
export const isSoOps = (r: string) => r === 'operations_exec' || r === 'gm';

/** The project tablet: blinking "Pending PIs n of N" until every manufacturer is submitted, then green "Submitted" */
export function OrderTablet({ o, small }: { o: Pick<SupplyOrder, 'submitted' | 'mfr_count'>; small?: boolean }) {
  return o.submitted >= o.mfr_count ? (
    <BlinkTablet still small={small} tone={colors.green} label={`Submitted · ${o.mfr_count} of ${o.mfr_count}`} />
  ) : (
    <BlinkTablet small={small} tone={colors.amber} label={`Pending PIs · ${o.submitted} of ${o.mfr_count} submitted`} />
  );
}

/** A PI's tablet: OK green; Revision requested and On hold blink; waiting for Operations blue; not submitted grey */
export function PiTablet({ p, small }: { p: Pick<SupplyPi, 'submitted_at' | 'ops_status'>; small?: boolean }) {
  if (!p.submitted_at) return <BlinkTablet still small={small} tone={colors.grey} label="Waiting for the PI" />;
  switch (p.ops_status) {
    case 'ok':
      return <BlinkTablet still small={small} tone={colors.green} label="OK" />;
    case 'revision':
      return <BlinkTablet small={small} tone={colors.red} label="Revision requested" />;
    case 'on_hold':
      return <BlinkTablet small={small} tone={colors.amber} label="On hold" />;
    default:
      return <BlinkTablet still small={small} tone={colors.blue} label="Submitted – with Operations" />;
  }
}

const money = (v: number | null, cur: string | null) => (v == null ? '—' : `${cur ?? ''} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim());

/** Estimation › Supply orders and Orders › Supply orders: every supply-only project with its tablets */
export function SupplyOrdersList() {
  const people = usePeople();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const { data, error, reload, loading } = useLoad(() => rpc<SupplyOrder[]>('so_list'));
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  // Open: a PI still to come, or one that is not OK yet
  const open = (o: SupplyOrder) => o.submitted < o.mfr_count || o.pis.some((p) => p.ops_status !== 'ok');
  const rows = show === 'open' ? data.filter(open) : data;
  return (
    <View style={{ gap: 10 }}>
      <Muted>Supply-only projects: once the sales person&apos;s invoice plan is approved, SM Estimation gets each manufacturer&apos;s PI and submits it – one by one or together – to Operations, who handles it by e-mail and sets its status.</Muted>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Segmented<'open' | 'all'> value={show} onChange={setShow} options={[{ value: 'open', label: `Open (${data.filter(open).length})` }, { value: 'all', label: `All (${data.length})` }]} />
        <Button small variant="ghost" title={loading ? 'Loading…' : 'Refresh'} onPress={reload} />
      </Row>
      {!rows.length ? <Empty title={show === 'open' ? 'No supply order waiting' : 'No supply orders yet'} hint="They open when a supply-only project's invoice plan is approved." /> : null}
      {rows.map((o) => (
        <Card key={o.id} onPress={() => router.push(`/supply-orders/${o.id}`)} style={{ gap: 6 }}>
          <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${o.code} · ${o.project}`}</Text>
              <Muted style={{ fontSize: 12 }}>{[o.customer, `Sales: ${people[o.sales_person_id ?? '']?.full_name ?? '—'}`, `opened ${fmtDate(o.created_at)}`].filter(Boolean).join(' · ')}</Muted>
            </View>
            <OrderTablet o={o} />
          </Row>
          {o.pis.map((p) => (
            <Row key={p.id} wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
              <Text style={{ color: colors.text, flex: 1, minWidth: 200 }}>{[p.manufacturer, p.country, p.pi_no ? `PI ${p.pi_no}` : null, p.pi_value != null ? money(p.pi_value, p.currency) : null].filter(Boolean).join(' · ')}</Text>
              <PiTablet p={p} small />
            </Row>
          ))}
          {o.mfr_count > o.pis.length ? <Muted style={{ fontSize: 12 }}>{`${o.mfr_count - o.pis.length} manufacturer(s) not entered yet`}</Muted> : null}
        </Card>
      ))}
    </View>
  );
}

type Detail = { order: SupplyOrder; pis: SupplyPi[] };

/** One supply order: manufacturers, PIs and costing (SM Estimation), the status of each PI (Operations) */
export function SupplyOrderView({ id }: { id: string }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const est = isSoEstimator(me.role);
  const ops = isSoOps(me.role);
  const { data, error, reload } = useLoad(async (): Promise<Detail | null> => {
    const list = await rpc<SupplyOrder[]>('so_list');
    const order = list.find((x) => x.id === id);
    if (!order) return null;
    const { data: rows } = await supabase.from('supply_pis').select('*').eq('order_id', id).order('seq');
    return { order, pis: (rows ?? []) as SupplyPi[] };
  }, [id]);
  if (data === null) return <Notice tone={colors.amber}>This supply order is not open to you.</Notice>;
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const { order: o, pis } = data;
  const editable = (p: SupplyPi) => est && (!p.submitted_at || p.ops_status === 'revision');

  const setCount = async () => {
    const r = await dialog.prompt({
      title: 'Number of manufacturers',
      message: 'How many manufacturers this project involves. The project stays "Pending PIs" until each one’s PI is submitted.',
      fields: [{ key: 'n', label: 'Manufacturers', required: true, initial: String(o.mfr_count) }],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(() => rpc('so_set_count', { p_order: o.id, p_n: Number(r.n) }), 'Saved').then(reload);
  };
  const edit = async (p?: SupplyPi) => {
    const r = await dialog.prompt({
      title: p ? `${p.manufacturer} – details and PI` : 'Add a manufacturer',
      message: 'Enter what is known now; the PI can be added when it arrives. Attach the PI (and the costing) on the manufacturer below, then submit.',
      fields: [
        { key: 'manufacturer', label: 'Manufacturer', required: true, initial: p?.manufacturer ?? '' },
        { key: 'country', label: 'Country', initial: p?.country ?? '' },
        { key: 'notes', label: 'Communication notes', type: 'multiline', initial: p?.notes ?? '', hint: 'e.g. 27 Oct asked for the PI · 29 Oct sample photos received' },
        { key: 'pi_no', label: 'PI number', initial: p?.pi_no ?? '' },
        { key: 'pi_date', label: 'PI date', type: 'date', initial: p?.pi_date ?? '' },
        { key: 'pi_value', label: 'PI value', initial: p?.pi_value != null ? String(p.pi_value) : '' },
        { key: 'currency', label: 'Currency', initial: p?.currency ?? '', hint: 'EUR, USD, CNY, LKR …' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(() => rpc('so_save_pi', { p_id: p?.id ?? null, p_order: o.id, p: { ...r, pi_value: r.pi_value?.replace(/,/g, '') } }), 'Saved').then(reload);
  };
  const remove = async (p: SupplyPi) => {
    if (!(await dialog.confirm(`Remove ${p.manufacturer}?`, 'Only a manufacturer whose PI is not submitted can be removed.', { confirmLabel: 'Remove', danger: true }))) return;
    await dialog.run(() => rpc('so_delete_pi', { p_id: p.id }), 'Removed').then(reload);
  };
  const submit = async (list: SupplyPi[]) => {
    const names = list.map((p) => p.manufacturer).join(', ');
    if (!(await dialog.confirm(`Submit ${list.length === 1 ? 'the PI' : `${list.length} PIs`} to Operations?`, `${names} – Operations is told and handles it by e-mail.`, { confirmLabel: 'Submit' }))) return;
    await dialog.run(() => rpc('so_submit', { p_ids: list.map((p) => p.id) }), 'Submitted to Operations').then(reload);
  };
  const setStatus = async (p: SupplyPi) => {
    const r = await dialog.prompt({
      title: `PI status – ${p.manufacturer}${p.pi_no ? ` · ${p.pi_no}` : ''}`,
      fields: [
        { key: 's', label: 'Status', type: 'select', required: true, initial: p.ops_status && p.ops_status !== 'pending' ? p.ops_status : '', options: [{ value: 'ok', label: 'OK' }, { value: 'revision', label: 'Revision requested' }, { value: 'on_hold', label: 'On hold' }] },
        { key: 'note', label: 'Note – what is needed, or why it is on hold', type: 'multiline', initial: p.ops_note ?? '', when: { key: 's', in: ['revision', 'on_hold'] } },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(() => rpc('so_set_status', { p_id: p.id, p_status: r.s, p_note: r.note || null }), 'Status saved').then(reload);
  };
  // Ready to submit: details complete (the server also checks the PI file)
  const ready = pis.filter((p) => editable(p) && p.pi_no && p.pi_date && p.pi_value && p.currency);
  const missing = Math.max(0, o.mfr_count - pis.length);

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{o.project}</Text>
            <Muted>{`${o.code} · Supply only · opened ${fmtDate(o.created_at)}`}</Muted>
          </View>
          <OrderTablet o={o} />
        </Row>
        <Grid min={180}>
          <KeyValue label="Customer" value={o.customer ?? '—'} />
          <KeyValue label="Sales person" value={people[o.sales_person_id ?? '']?.full_name ?? '—'} />
          {o.order_value != null ? <KeyValue label="Order value" value={fmtMoney(o.order_value)} /> : null}
          <KeyValue label="Manufacturers" value={`${o.mfr_count} · ${pis.filter((p) => p.submitted_at).length} submitted`} />
        </Grid>
        <Row wrap gap={8}>
          <Button small variant="secondary" title="Order book ›" onPress={() => router.push(`/finance/secured/${o.secured_id}`)} />
          {est ? <Button small variant="secondary" title="Number of manufacturers" onPress={setCount} /> : null}
          {est && missing ? <Button small title="+ Add manufacturer" onPress={() => edit()} /> : null}
          {est && ready.length > 1 ? <Button small title={`Submit ${ready.length} ready PIs`} onPress={() => submit(ready)} /> : null}
        </Row>
      </Card>

      <Section title="Manufacturers and PIs">
        <View style={{ gap: 10 }}>
          {pis.map((p) => (
            <Card key={p.id} style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: p.ops_status === 'ok' ? colors.green : p.ops_status === 'revision' ? colors.red : p.ops_status === 'on_hold' ? colors.amber : p.submitted_at ? colors.blue : colors.line }}>
              <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>{`${p.seq} · ${p.manufacturer}${p.country ? ` (${p.country})` : ''}`}</Text>
                <PiTablet p={p} />
              </Row>
              {p.notes ? <Muted>{p.notes}</Muted> : null}
              <Grid min={180}>
                <KeyValue label="PI" value={p.pi_no ? `${p.pi_no}${p.pi_date ? ` · ${fmtDate(p.pi_date)}` : ''}` : '—'} />
                <KeyValue label="Value" value={money(p.pi_value, p.currency)} />
                {p.submitted_at ? <KeyValue label="Submitted" value={`${fmtDateTime(p.submitted_at)}${p.revision ? ` · revision ${p.revision}` : ''}`} /> : null}
              </Grid>
              {p.ops_note ? (
                <Notice tone={p.ops_status === 'revision' ? colors.red : colors.amber}>{`Operations${p.ops_at ? ` (${fmtDateTime(p.ops_at)})` : ''}: ${p.ops_note}`}</Notice>
              ) : null}
              <Attachments entityType="supply_pi" entityId={p.id} kinds={['supply_pi', 'supply_costing']} title="PI and costing" canUpload={editable(p)} />
              <Row wrap gap={8}>
                {editable(p) ? <Button small variant="secondary" title="Edit details" onPress={() => edit(p)} /> : null}
                {editable(p) ? <Button small title={p.ops_status === 'revision' ? 'Submit the revised PI' : 'Submit to Operations'} onPress={() => submit([p])} /> : null}
                {est && !p.submitted_at ? <Button small variant="ghost" title="Remove" onPress={() => remove(p)} /> : null}
                {ops && p.submitted_at ? <Button small variant={p.ops_status === 'pending' ? 'primary' : 'secondary'} title="Set status" onPress={() => setStatus(p)} /> : null}
              </Row>
            </Card>
          ))}
          {Array.from({ length: missing }, (_, i) => (
            <Card key={`m${i}`} style={{ borderStyle: 'dashed' }}>
              <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Muted>{`${pis.length + i + 1} · manufacturer not entered yet`}</Muted>
                <BlinkTablet small tone={colors.amber} label="Pending PI" />
              </Row>
            </Card>
          ))}
        </View>
      </Section>
    </View>
  );
}

/** Home (Operations, SM Estimation): the open supply orders with their tablets */
export function SupplyOrdersCard({ href }: { href: '/orders/supply' | '/estimating/supply' }) {
  const { data } = useLoad(() => rpc<SupplyOrder[]>('so_list').catch(() => []));
  const open = (data ?? []).filter((o) => o.submitted < o.mfr_count || o.pis.some((p) => p.ops_status !== 'ok'));
  if (!open.length) return null;
  return (
    <Section title={`Supply orders – ${open.length} open`} right={<Button small variant="ghost" title="All ›" onPress={() => router.push(href)} />}>
      <Card style={{ gap: 8 }}>
        {open.slice(0, 6).map((o) => (
          <View key={o.id} style={{ gap: 4, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text onPress={() => router.push(`/supply-orders/${o.id}`)} style={{ fontWeight: '700', color: colors.ink, flex: 1, minWidth: 180 }}>{`${o.code} · ${o.project}`}</Text>
              <OrderTablet o={o} small />
            </Row>
            <Row wrap gap={6}>
              {o.pis.filter((p) => p.submitted_at && p.ops_status !== 'ok').map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Muted style={{ fontSize: 12 }}>{p.manufacturer}</Muted>
                  <PiTablet p={p} small />
                </View>
              ))}
            </Row>
          </View>
        ))}
      </Card>
    </Section>
  );
}
