import { Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { ErrorBanner, Loading, Muted, Notice, Screen, Segmented, colors } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { isTou, type Tariff } from '@/lib/tariffs';

type Row_ = Tariff & { sort: number; updated_by: string | null };
const num = (v: string | undefined) => (v && v.trim() !== '' ? Number(v.replace(/,/g, '')) : null);
const money = (v: number | null) => (v != null ? v.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

/** Electricity tariffs (PUCSL schedule) for the savings in DLux – kept by SM Projects, GM / DGM or the Design Manager */
export default function Tariffs() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [supplier, setSupplier] = useState<'EDL' | 'LECO'>('EDL');
  const editor = ['sm_projects', 'gm', 'design_manager', 'sys_admin'].includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const { data: t, error: e } = await supabase.from('electricity_tariffs').select('*').eq('active', true).order('sort');
    if (e) throw new Error(e.message);
    return (t ?? []) as Row_[];
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const edit = async (t: Row_) => {
    const tou = isTou(t);
    const r = await dialog.prompt({
      title: `${t.supplier} ${t.code} – ${t.name}`,
      message: 'From the current PUCSL tariff decision (30-day billing cycle).',
      fields: [
        ...(tou
          ? [
              { key: 'peak', label: 'Peak 18:30–22:30 (LKR/kWh)', initial: t.peak != null ? String(t.peak) : '' },
              { key: 'day', label: 'Day 05:30–18:30 (LKR/kWh)', initial: t.day != null ? String(t.day) : '' },
              { key: 'off', label: 'Off-peak 22:30–05:30 (LKR/kWh)', initial: t.off_peak != null ? String(t.off_peak) : '' },
            ]
          : [{ key: 'rate', label: 'Energy charge (LKR/kWh)', hint: 'For block tariffs, the top block', initial: t.rate != null ? String(t.rate) : '' }]),
        { key: 'fixed', label: 'Fixed charge (LKR/month)', initial: t.fixed != null ? String(t.fixed) : '' },
        { key: 'demand', label: 'Demand charge (LKR/kVA)', initial: t.demand != null ? String(t.demand) : '' },
        { key: 'from', label: 'Effective from', type: 'date', initial: t.effective_from ?? '' },
        { key: 'note', label: 'Note', type: 'multiline', initial: t.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('electricity_tariffs')
        .update({
          ...(tou ? { peak: num(r.peak), day: num(r.day), off_peak: num(r.off) } : { rate: num(r.rate) }),
          fixed: num(r.fixed),
          demand: num(r.demand),
          effective_from: r.from || null,
          note: r.note || null,
          updated_by: me.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', t.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };
  const rows = data.filter((t) => t.supplier === supplier);
  const missing = rows.filter((t) => t.rate == null && t.day == null).length;
  const from = rows.find((t) => t.effective_from)?.effective_from;
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Electricity tariffs' }} />
      <Muted>{`PUCSL approved tariff for a 30-day billing cycle${from ? `, effective ${fmtDate(from)}` : ''}. The same tariff applies to EDL (formerly CEB) and LECO; LECO also offers pre-paid. Time of use: peak 18:30–22:30, day 05:30–18:30, off-peak 22:30–05:30.`}</Muted>
      <Segmented value={supplier} onChange={setSupplier} options={[{ value: 'EDL', label: 'EDL (formerly CEB)' }, { value: 'LECO', label: 'LECO' }]} />
      {missing ? <Notice tone={colors.amber}>{`${missing} categories have no rate yet.${editor ? ' Tap a row to set it.' : ''}`}</Notice> : null}
      <DataTable
        rows={rows}
        keyOf={(t) => t.id}
        onPress={editor ? edit : undefined}
        columns={[
          { h: 'Category', w: 300, grow: true, v: (t) => `${t.code} · ${t.name}${t.note ? `\n${t.note}` : ''}` },
          { h: 'Type', w: 130, v: (t) => t.family ?? '' },
          { h: 'Energy LKR/kWh', w: 170, right: true, v: (t) => (isTou(t) ? `P ${money(t.peak)} · D ${money(t.day)}\nOP ${money(t.off_peak)}` : money(t.rate)) },
          { h: 'Fixed /month', w: 110, right: true, v: (t) => money(t.fixed) },
          { h: 'Demand /kVA', w: 110, right: true, v: (t) => money(t.demand) },
          { h: 'Set by', w: 130, v: (t) => (t.updated_by ? people[t.updated_by]?.full_name ?? '' : 'PUCSL schedule') },
        ]}
      />
    </Screen>
  );
}
