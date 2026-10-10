import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { IPC_STATUS, type Ipc } from '@/lib/billing';
import type { IpcDetail } from '@/lib/boq';
import { fmtMonth } from '@/lib/finance';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const ipcTone = (c: Ipc) => (c.status === 'certified' ? colors.green : c.status === 'returned' ? colors.red : c.status === 'submitted' ? colors.blue : colors.amber);
type Line = IpcDetail['lines'][number];

/**
 * One progress claim: the measurement (quantities), the valuation for the billing roles, the IPA submitted to the client /
 * consultant and their certification – quantities and the amount as adjusted by them. The IPA and the invoice are made in SAP.
 */
export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const see = me.role === 'senior_elec_engineer';
  const [cert, setCert] = useState<Record<string, string> | null>(null);
  const [cDate, setCDate] = useState<string | null>(todayISO());
  const [cRef, setCRef] = useState('');
  const [cValue, setCValue] = useState('');
  const [cNote, setCNote] = useState('');
  const { data, error, reload } = useLoad(async () => {
    const { data: c, error: e } = await supabase.from('exec_ipcs').select('*, exec_projects(name, code, secured_id)').eq('id', id).maybeSingle();
    if (e) throw new Error(e.message);
    if (!c) return null;
    const d = await rpc<IpcDetail>('ipc_detail', { p_ipc: id });
    const ep = (c as { exec_projects: { name: string; code: string; secured_id: string | null } | null }).exec_projects;
    return { c: c as Ipc, ep, d };
  }, [id]);
  if (data === null) return <Screen><Notice>This claim has been certified – the amounts stay with the Senior Electrical Engineer.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { c, ep, d } = data;
  const v = d.values;
  const money = !!v;

  const submitIpa = async () => {
    const res = await dialog.prompt({
      title: 'IPA submitted to the client / consultant',
      message: 'The IPA is made in SAP from these quantities. Record when the physical IPA went to the client / consultant.',
      fields: [
        { key: 'd', label: 'Submitted on', type: 'date', required: true, initial: todayISO() },
        { key: 'r', label: 'IPA number / letter reference' },
      ],
      confirmLabel: 'Record',
    });
    if (res) await dialog.run(async () => { await rpc('submit_ipc_to_client', { p_id: c.id, p_date: res.d, p_ref: res.r || null }); await reload(); }, 'Recorded – waiting for the certification');
  };
  const startCert = () => setCert(Object.fromEntries(d.lines.map((l) => [l.boq_item_id, String(Number(l.qty_to_date))])));
  const certGross = (q: Record<string, string>) => d.lines.reduce((s, l) => s + Number(q[l.boq_item_id] || 0) * Number(l.rate ?? 0), 0);
  const saveCert = async () => {
    if (!cert) return;
    const lines = d.lines.filter((l) => cert[l.boq_item_id] !== '' && Number(cert[l.boq_item_id]) !== Number(l.qty_to_date)).map((l) => ({ boq_item_id: l.boq_item_id, cert_qty: Number(cert[l.boq_item_id]) }));
    if (!d.lines.length && !cValue.trim()) return dialog.toast('Enter the amount certified', 'error');
    await dialog.run(async () => {
      await rpc('record_ipc_certification', { p_id: c.id, p: { date: cDate, ref: cRef || null, value: cValue.trim() || null, note: cNote || null, lines } });
      setCert(null);
      await reload();
    }, lines.length ? 'Certified – adjusted quantities recorded' : 'Certified');
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
        {c.adjusted ? <Pill label="Adjusted by the client / consultant" tone={colors.amber} /> : null}
      </Row>
      <Muted>{`Measured by ${people[c.prepared_by]?.full_name ?? ''} · ${fmtDateTime(c.prepared_at)}${c.measurement ? ` · ${c.measurement}` : ''}`}</Muted>
      {c.submitted_on ? <Muted>{`IPA submitted ${fmtDate(c.submitted_on)}${c.submitted_ref ? ` · ${c.submitted_ref}` : ''}`}</Muted> : null}
      {c.cert_date ? <Muted>{`Certified ${fmtDate(c.cert_date)}${c.cert_ref ? ` · ${c.cert_ref}` : ''}`}</Muted> : null}
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
      {see && ['prepared', 'submitted'].includes(c.status) && !cert ? (
        <Row gap={8} wrap>
          {c.status === 'prepared' ? <Button title="IPA submitted to the client" onPress={submitIpa} /> : null}
          <Button title="Record the certification" variant={c.status === 'prepared' ? 'secondary' : 'primary'} onPress={startCert} />
          {c.status === 'prepared' ? <Button title="Return to the AE" variant="secondary" onPress={ret} /> : null}
        </Row>
      ) : null}
      {cert ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Certification by the client / consultant</Text>
          <Muted>Change the quantities they adjusted in the “Certified” column below. The amount is worked out from them, or enter the certified amount.</Muted>
          <Grid min={200}>
            <DateField label="Certified on" required value={cDate} onChange={setCDate} />
            <Field label="Certificate / reference" value={cRef} onChangeText={setCRef} />
            <Field
              label="Amount certified this claim (LKR)"
              value={cValue}
              onChangeText={setCValue}
              keyboardType="decimal-pad"
              placeholder={v ? fmtNumber(certGross(cert) + Number(v.mos_value) - Number(v.previous_certified), 2) : ''}
            />
          </Grid>
          <Field label="Note" value={cNote} onChangeText={setCNote} multiline />
          <Row gap={8}>
            <Button title="Save the certification" onPress={saveCert} />
            <Button title="Cancel" variant="secondary" onPress={() => setCert(null)} />
          </Row>
        </Card>
      ) : null}

      {d.lines.length ? (
        <Section title="Work measured (to date)">
          <DataTable
            rows={d.lines}
            keyOf={(l) => l.boq_item_id}
            edge={(l) => (l.cert_qty != null && l.cert_qty !== l.qty_to_date ? colors.amber : l.qty_to_date !== (l.prev_qty ?? 0) ? colors.blue : undefined)}
            columns={[
              { h: 'Item', w: 70, v: (l) => l.item_no ?? '' },
              { h: 'Description', w: 300, v: (l) => l.description },
              { h: 'Unit', w: 55, v: (l) => l.unit ?? '' },
              { h: 'BOQ qty', w: 80, right: true, v: (l) => (l.boq_qty == null ? '' : fmtNumber(l.boq_qty, 2)) },
              { h: 'Previous', w: 80, right: true, v: (l) => fmtNumber(l.prev_qty ?? 0, 2) },
              { h: 'To date', w: 80, right: true, v: (l) => fmtNumber(l.qty_to_date, 2), tone: (l) => (l.boq_qty != null && l.qty_to_date > l.boq_qty ? colors.amber : undefined) },
              { h: 'This month', w: 90, right: true, v: (l) => fmtNumber(l.qty_to_date - (l.prev_qty ?? 0), 2) },
              ...(cert || c.status === 'certified'
                ? [
                    {
                      h: 'Certified',
                      w: 110,
                      right: true,
                      bold: true,
                      tone: (l: Line) => ((l.cert_qty ?? l.qty_to_date) !== l.qty_to_date ? colors.amber : undefined),
                      v: (l: Line) =>
                        cert ? (
                          <TextInput
                            value={cert[l.boq_item_id] ?? ''}
                            onChangeText={(t) => setCert((q) => ({ ...(q ?? {}), [l.boq_item_id]: t.replace(/[^0-9.]/g, '') }))}
                            keyboardType="decimal-pad"
                            style={{ width: 90, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, textAlign: 'right', color: colors.ink, backgroundColor: colors.card }}
                          />
                        ) : (
                          fmtNumber(l.cert_qty ?? l.qty_to_date, 2)
                        ),
                    },
                  ]
                : []),
              ...(money
                ? [
                    { h: 'Rate', w: 100, right: true, v: (l: Line) => fmtNumber(l.rate ?? 0, 2) },
                    { h: 'Value to date', w: 120, right: true, v: (l: Line) => fmtNumber(l.value ?? 0, 2) },
                    ...(c.status === 'certified' ? [{ h: 'Certified value', w: 130, right: true, v: (l: Line) => fmtNumber((l.cert_qty ?? l.qty_to_date) * (l.rate ?? 0), 2) }] : []),
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
