import { Stack } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { Instrument } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Test instruments with calibration due dates: tests cannot be saved with an expired instrument. */
export default function Instruments() {
  const me = useMe();
  const dialog = useDialog();
  const { data, error, reload, loading } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('test_instruments').select('*').order('name');
    if (e) throw new Error(e.message);
    return (r ?? []) as Instrument[];
  });
  const canEdit = me.role === 'senior_elec_engineer' || me.role === 'operations_exec' || me.role === 'sm_projects';
  const edit = async (i?: Instrument) => {
    const res = await dialog.prompt({
      title: i ? i.name : 'Add instrument',
      fields: [
        { key: 'name', label: 'Instrument', required: true, initial: i?.name },
        { key: 'model', label: 'Model', initial: i?.model ?? '' },
        { key: 'serial', label: 'Serial number', required: true, initial: i?.serial_no },
        { key: 'due', label: 'Calibration due', type: 'date', required: true, initial: i?.calibration_due },
        { key: 'active', label: 'In use', type: 'select', initial: i && !i.active ? 'no' : 'yes', options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No – retired' },
        ] },
      ],
      confirmLabel: 'Save',
    });
    if (res)
      await dialog.run(async () => {
        await rpc('save_instrument', { p_id: i?.id ?? null, p_name: res.name, p_model: res.model || null, p_serial: res.serial, p_due: res.due, p_active: res.active !== 'no' });
        await reload();
      }, 'Saved');
  };
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const soon = addDaysISO(todayISO(), 30);
  return (
    <Screen maxWidth={860} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Test instruments' }} />
      <TestingBanner what="QA / QC" />
      {canEdit ? (
        <Row>
          <Button title="+ Instrument" onPress={() => edit()} />
        </Row>
      ) : null}
      {data.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.map((i) => {
            const exp = i.calibration_due < todayISO();
            return (
              <ListRow
                key={i.id}
                wrapRight
                onPress={canEdit ? () => edit(i) : undefined}
                highlight={i.active && exp ? colors.red : undefined}
                title={`${i.name}${i.model ? ` ${i.model}` : ''}`}
                subtitle={`Serial ${i.serial_no} · calibration due ${fmtDate(i.calibration_due)}`}
                right={
                  <Pill
                    label={!i.active ? 'Retired' : exp ? 'Calibration expired' : i.calibration_due <= soon ? 'Due within 30 days' : 'Calibrated'}
                    tone={!i.active ? colors.grey : exp ? colors.red : i.calibration_due <= soon ? colors.amber : colors.green}
                  />
                }
              />
            );
          })}
        </Card>
      ) : (
        <Empty title="No instruments" />
      )}
    </Screen>
  );
}
