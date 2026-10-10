import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { INSTRUMENT_FIELDS, RequestRows } from '@/components/InstrumentsView';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { calState, instrumentTitle, type Instrument, type InstrumentRequest } from '@/lib/instruments';
import { rpc, supabase } from '@/lib/supabase';

/** One instrument: details, condition, calibration and its report (Operations uploads, members download), queue and history. */
export default function InstrumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const ops = me.role === 'operations_exec';
  const { data, error, reload } = useLoad(async () => {
    const [i, r, p] = await Promise.all([
      supabase.from('instruments').select('*').eq('id', id).maybeSingle(),
      supabase.from('instrument_requests').select('*').eq('instrument_id', id).order('requested_at', { ascending: false }),
      supabase.from('exec_projects').select('id, name, code'),
    ]);
    if (i.error) throw new Error(i.error.message);
    return { i: i.data as Instrument | null, requests: (r.data ?? []) as InstrumentRequest[], projects: (p.data ?? []) as Pick<ExecProject, 'id' | 'name' | 'code'>[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const i = data.i;
  if (!i) return <Screen><Notice>Instrument not found.</Notice></Screen>;
  const cal = calState(i, todayISO());
  const live = data.requests.filter((r) => ['waiting', 'ready', 'issued'].includes(r.status)).sort((a, b) => (a.status === 'issued' ? -1 : b.status === 'issued' ? 1 : a.need_from.localeCompare(b.need_from)));
  const past = data.requests.filter((r) => !['waiting', 'ready', 'issued'].includes(r.status));
  const run = (fn: string, args: Record<string, unknown>, ok: string) => dialog.run(async () => { await rpc(fn, args); await reload(); }, ok);

  const edit = async () => {
    const res = await dialog.prompt({ title: 'Edit the instrument', fields: INSTRUMENT_FIELDS(i), confirmLabel: 'Save' });
    if (res) await run('save_instrument', { p: { ...res, id: i.id } }, 'Saved');
  };
  const condition = async () => {
    if (i.condition === 'out_of_order') return run('set_instrument_condition', { p_id: i.id, p_condition: 'ok' }, 'Back in service – the people waiting are told');
    const res = await dialog.prompt({ title: 'Out of order', fields: [{ key: 'n', label: 'What is wrong', type: 'multiline', required: true }], confirmLabel: 'Set out of order', danger: true });
    if (res) await run('set_instrument_condition', { p_id: i.id, p_condition: 'out_of_order', p_note: res.n }, 'Set out of order – the people waiting are told');
  };
  const calibration = async () => {
    const res = await dialog.prompt({
      title: 'Calibration',
      message: 'Upload the calibration certificate / test report below after saving.',
      fields: [
        { key: 'status', label: 'Status', type: 'select', required: true, initial: 'calibrated', options: [{ value: 'calibrated', label: 'Calibration done' }, { value: 'not_calibrated', label: 'Not calibrated' }] },
        { key: 'date', label: 'Calibrated on', type: 'date', initial: i.cal_date ?? todayISO() },
        { key: 'expiry', label: 'Calibration expires on', type: 'date', initial: i.cal_expiry ?? undefined },
        { key: 'cert_no', label: 'Certificate number', initial: i.cal_cert_no ?? '' },
        { key: 'lab', label: 'Calibrated by (laboratory)', initial: i.cal_lab ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (res) await run('set_instrument_calibration', { p_id: i.id, p: res }, 'Calibration saved');
  };
  const remove = async () => {
    const res = await dialog.prompt({ title: 'Remove from the list', fields: [{ key: 'r', label: 'Reason (sold, written off, lost …)', type: 'multiline', required: true }], confirmLabel: 'Remove', danger: true });
    if (res)
      await dialog.run(async () => {
        await rpc('remove_instrument', { p_id: i.id, p_reason: res.r });
        router.replace('/instruments');
      }, 'Removed');
  };

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Stack.Screen options={{ title: i.code ?? 'Instrument' }} />
      <TestingBanner what="Instruments" />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${i.code ?? ''} · ${i.name}`}</Text>
          <Row gap={6} wrap>
            {i.removed ? <Pill label="Removed" tone={colors.grey} solid /> : null}
            <Pill label={i.condition === 'out_of_order' ? 'Out of order' : live.some((r) => r.status === 'issued') ? 'In use' : 'Available'} tone={i.condition === 'out_of_order' ? colors.red : live.some((r) => r.status === 'issued') ? colors.blue : colors.green} solid />
            <Pill label={cal.label} tone={cal.tone} />
          </Row>
        </Row>
        <KeyValue label="Instrument" value={instrumentTitle(i)} />
        {i.category ? <KeyValue label="Type" value={i.category} /> : null}
        {i.asset_no ? <KeyValue label="Asset number" value={i.asset_no} /> : null}
        {i.range_spec ? <KeyValue label="Range / accuracy" value={i.range_spec} /> : null}
        {i.home ? <KeyValue label="Kept at" value={i.home} /> : null}
        {i.notes ? <KeyValue label="Notes" value={i.notes} /> : null}
        <KeyValue
          label="Calibration"
          value={i.cal_status === 'calibrated' ? `Done ${fmtDate(i.cal_date)} · expires ${fmtDate(i.cal_expiry)}${i.cal_cert_no ? ` · cert ${i.cal_cert_no}` : ''}${i.cal_lab ? ` · ${i.cal_lab}` : ''}` : 'Not calibrated'}
        />
        {i.condition === 'out_of_order' ? <Notice tone={colors.red}>{`Out of order – ${i.fault_note ?? ''}`}</Notice> : null}
        {!cal.ok ? <Notice tone={colors.amber}>Not calibrated: it can be used, but you and Operations are alerted when you request it, and readings may not be accepted.</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 6 }}>
          {!i.removed && i.condition === 'ok' && !live.some((r) => r.requested_by === me.id) ? (
            <Button title="Request" onPress={() => router.push({ pathname: '/instruments/request', params: { instrument: i.id } })} />
          ) : null}
          {ops && !i.removed ? (
            <>
              <Button variant="secondary" title="Edit" onPress={edit} />
              <Button variant="secondary" title="Calibration" onPress={calibration} />
              <Button variant="secondary" title={i.condition === 'out_of_order' ? 'Back in service' : 'Out of order'} onPress={condition} />
              <Button variant="ghost" title="Remove" onPress={remove} />
            </>
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="instrument" entityId={i.id} kinds={['cal_report']} title="Calibration certificate / test report" canUpload={ops && !i.removed} />
      <Section title={`Now and next (${live.length})`}>
        <RequestRows rows={live} instruments={[i]} projects={data.projects} onChange={reload} showInstrument={false} />
      </Section>
      <Section title={`History (${past.length})`}>
        <RequestRows rows={past} instruments={[i]} projects={data.projects} onChange={reload} showInstrument={false} />
      </Section>
    </Screen>
  );
}
