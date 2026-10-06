import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { IPC_STATUS, type InvoiceTrigger, type Ipc } from '@/lib/billing';
import type { IpcDetail } from '@/lib/boq';
import { fmtMonth, kindLabel, type InvoiceLine } from '@/lib/finance';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const ipcTone = (c: Ipc) => (c.status === 'certified' ? colors.green : c.status === 'returned' ? colors.red : colors.amber);

/** One progress claim: the measurement (quantities), the valuation for the billing roles, and certification by the SEE. */
export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const see = me.role === 'senior_elec_engineer';
  const { data, error, reload } = useLoad(async () => {
    const { data: c, error: e } = await supabase.from('exec_ipcs').select('*, exec_projects(name, code, secured_id)').eq('id', id).maybeSingle();
    if (e) throw new Error(e.message);
    if (!c) return null;
    const d = await rpc<IpcDetail>('ipc_detail', { p_ipc: id });
    const ep = (c as { exec_projects: { name: string; code: string; secured_id: string | null } | null }).exec_projects;
    let lines: InvoiceLine[] = [];
    let triggers: InvoiceTrigger[] = [];
    if (see && ep?.secured_id) {
      const [l, t] = await Promise.all([
        supabase.from('invoice_line_status').select('*').eq('secured_id', ep.secured_id).order('seq'),
        supabase.from('exec_invoice_triggers').select('*').eq('exec_project_id', (c as Ipc).exec_project_id),
      ]);
      lines = (l.data ?? []) as InvoiceLine[];
      triggers = (t.data ?? []) as InvoiceTrigger[];
    }
    return { c: c as Ipc, ep, d, lines, triggers };
  }, [id, see]);
  if (data === null) return <Screen><Notice>This claim has been certified – the amounts stay with the Senior Electrical Engineer.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { c, ep, d } = data;
  const v = d.values;
  const money = !!v;

  const certify = async () => {
    const trig = Object.fromEntries(data.triggers.map((t) => [t.line_id, t]));
    const open = data.lines.filter((l) => Number(l.remaining) > 0 && (trig[l.id]?.kind === 'ipc' || l.kind === 'progress'));
    if (!open.length) return dialog.toast('No progress-claim invoice line with a balance – check the invoicing plan', 'error');
    const res = await dialog.prompt({
      title: `Certify ${c.code ?? 'the claim'}`,
      message: v ? `Valuation: ${fmtMoney(v.suggested, 'LKR')} this claim (gross ${fmtMoney(v.gross_value, 'LKR')} less ${fmtMoney(v.previous_certified, 'LKR')} certified before).` : undefined,
      fields: [
        {
          key: 'line',
          label: 'Invoice line',
          type: 'select',
          required: true,
          initial: open[0].id,
          options: open.map((l) => ({ value: l.id, label: `${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''}`, hint: `${fmtMoney(l.remaining, 'LKR')} open · ${fmtMonth(l.forecast_month)}` })),
        },
        { key: 'v', label: 'Amount certified by the client (LKR)', required: true, initial: v && v.suggested > 0 ? String(v.suggested) : '' },
        { key: 'n', label: 'Note (certificate no., consultant)', type: 'multiline' },
      ],
      confirmLabel: 'Certify',
    });
    if (res)
      await dialog.run(async () => {
        await rpc('certify_ipc', { p_id: c.id, p_ok: true, p_line: res.line, p_value: Number(res.v.replace(/,/g, '')), p_note: res.n || null });
        await reload();
      }, 'Certified – Operations told to invoice');
  };
  const ret = async () => {
    const res = await dialog.prompt({ title: 'Return the measurement', fields: [{ key: 'n', label: 'What to correct', type: 'multiline', required: true }], confirmLabel: 'Return', danger: true });
    if (res) await dialog.run(async () => { await rpc('certify_ipc', { p_id: c.id, p_ok: false, p_note: res.n }); await reload(); }, 'Returned to the Assistant Engineer');
  };

  return (
    <Screen onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: c.code ?? 'Progress claim' }} />
      <TestingBanner what="Progress claims" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{`${c.code ?? 'Progress claim'} · ${fmtMonth(c.period)}`}</Text>
      <Muted>{[ep?.code, ep?.name].filter(Boolean).join(' · ')}</Muted>
      <Row gap={6} wrap>
        <Pill label={IPC_STATUS[c.status]} tone={ipcTone(c)} solid={c.status === 'certified'} />
        <Pill label={`${fmtNumber(Number(c.measured_pct), 1)}% of the work done`} />
        {money && c.certified_value != null ? <Pill label={`Certified ${fmtMoney(c.certified_value, 'LKR')}`} tone={colors.green} /> : null}
      </Row>
      <Muted>{`Measured by ${people[c.prepared_by]?.full_name ?? ''} · ${fmtDateTime(c.prepared_at)}${c.measurement ? ` · ${c.measurement}` : ''}`}</Muted>
      {c.note ? <Notice tone={c.status === 'returned' ? colors.red : colors.blue}>{c.note}</Notice> : null}
      {c.status === 'returned' && me.role === 'assistant_engineer' ? (
        <Button title="Measure again" onPress={() => router.push(`/execution/claim/new?project=${c.exec_project_id}`)} />
      ) : null}

      {v ? (
        <Section title="Valuation">
          <Grid min={170}>
            <Stat label="Work done to date" value={fmtMoney(v.work_value, 'LKR')} />
            <Stat label={`Material on site${d.mos_pct ? ` (${fmtNumber(d.mos_pct, 0)}%)` : ''}`} value={fmtMoney(v.mos_value, 'LKR')} />
            <Stat label="Gross to date" value={fmtMoney(v.gross_value, 'LKR')} />
            <Stat label="Less certified before" value={fmtMoney(v.previous_certified, 'LKR')} />
            <Stat label="This claim" value={fmtMoney(v.suggested, 'LKR')} tone="green" />
          </Grid>
          {v.previous_mos > v.mos_value ? <Muted>{`Material on site recovered since the last certified claim: ${fmtMoney(v.previous_mos - v.mos_value, 'LKR')} (now installed and measured as work).`}</Muted> : null}
        </Section>
      ) : null}
      {see && c.status === 'prepared' ? (
        <Row gap={8}>
          <Button title="Record the certified amount" onPress={certify} />
          <Button title="Return" variant="secondary" onPress={ret} />
        </Row>
      ) : null}

      {d.lines.length ? (
        <Section title="Work measured (to date)">
          <DataTable
            rows={d.lines}
            keyOf={(l) => l.boq_item_id}
            edge={(l) => (l.qty_to_date !== (l.prev_qty ?? 0) ? colors.blue : undefined)}
            columns={[
              { h: 'Item', w: 70, v: (l) => l.item_no ?? '' },
              { h: 'Description', w: 300, v: (l) => l.description },
              { h: 'Unit', w: 55, v: (l) => l.unit ?? '' },
              { h: 'BOQ qty', w: 80, right: true, v: (l) => (l.boq_qty == null ? '' : fmtNumber(l.boq_qty, 2)) },
              { h: 'Previous', w: 80, right: true, v: (l) => fmtNumber(l.prev_qty ?? 0, 2) },
              { h: 'To date', w: 80, right: true, v: (l) => fmtNumber(l.qty_to_date, 2), tone: (l) => (l.boq_qty != null && l.qty_to_date > l.boq_qty ? colors.amber : undefined) },
              { h: 'This month', w: 90, right: true, v: (l) => fmtNumber(l.qty_to_date - (l.prev_qty ?? 0), 2) },
              ...(money
                ? [
                    { h: 'Rate', w: 100, right: true, v: (l: IpcDetail['lines'][number]) => fmtNumber(l.rate ?? 0, 2) },
                    { h: 'Value to date', w: 120, right: true, v: (l: IpcDetail['lines'][number]) => fmtNumber(l.value ?? 0, 2) },
                  ]
                : []),
            ]}
          />
        </Section>
      ) : null}
      {d.mos.length ? (
        <Section title="Material on site claimed">
          <DataTable
            rows={d.mos}
            keyOf={(m) => m.item}
            columns={[
              { h: 'Material', w: 220, v: (m) => m.item },
              { h: 'Qty', w: 80, right: true, v: (m) => `${fmtNumber(m.qty, 2)} ${m.unit}` },
              { h: 'BOQ item', w: 260, v: (m) => m.boq_item },
              ...(money
                ? [
                    { h: 'Rate', w: 100, right: true, v: (m: IpcDetail['mos'][number]) => fmtNumber(m.rate ?? 0, 2) },
                    { h: 'Value', w: 120, right: true, v: (m: IpcDetail['mos'][number]) => fmtNumber(m.value ?? 0, 2) },
                  ]
                : []),
            ]}
          />
        </Section>
      ) : null}
    </Screen>
  );
}
