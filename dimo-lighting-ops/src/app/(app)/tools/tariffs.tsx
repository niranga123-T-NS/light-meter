import { Stack } from 'expo-router';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { ErrorBanner, Loading, Muted, Notice, Screen, colors } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Tariff = { id: string; supplier: string; code: string; name: string; rate: number | null; note: string | null; effective_from: string | null; updated_by: string | null };

/** Electricity tariffs for the savings in Quick calculations – the rates kept by SM Projects, GM / DGM or the Design Manager */
export default function Tariffs() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const editor = ['sm_projects', 'gm', 'design_manager', 'sys_admin'].includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const { data: t, error: e } = await supabase.from('electricity_tariffs').select('*').eq('active', true).order('sort');
    if (e) throw new Error(e.message);
    return (t ?? []) as Tariff[];
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const edit = async (t: Tariff) => {
    const r = await dialog.prompt({
      title: `${t.supplier} ${t.code} – ${t.name}`,
      message: 'The average energy charge per kWh from the current PUCSL tariff schedule (for time-of-use tariffs, a blended rate for daytime use).',
      fields: [
        { key: 'rate', label: 'Energy rate (LKR per kWh)', initial: t.rate != null ? String(t.rate) : '' },
        { key: 'from', label: 'Effective from', type: 'date', initial: t.effective_from ?? '' },
        { key: 'note', label: 'Note', hint: 'e.g. PUCSL decision of …; fixed charge not included', initial: t.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('electricity_tariffs')
        .update({ rate: r.rate ? Number(r.rate.replace(/,/g, '')) : null, effective_from: r.from || null, note: r.note || null, updated_by: me.id, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };
  const missing = data.filter((t) => t.rate == null).length;
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: 'Electricity tariffs' }} />
      <Muted>CEB and LECO customer categories used for the savings in Quick calculations. Enter the rates from the current PUCSL tariff schedule; until a rate is set, the sales person types the client’s rate.</Muted>
      {missing ? <Notice tone={colors.amber}>{`${missing} categories have no rate yet.${editor ? ' Tap a row to set it.' : ''}`}</Notice> : null}
      <DataTable
        rows={data}
        keyOf={(t) => t.id}
        onPress={editor ? edit : undefined}
        columns={[
          { h: 'Supplier', w: 80, v: (t) => t.supplier },
          { h: 'Category', w: 260, grow: true, v: (t) => `${t.code} · ${t.name}${t.note ? `\n${t.note}` : ''}` },
          { h: 'LKR / kWh', w: 100, right: true, v: (t) => (t.rate != null ? String(t.rate) : '—') },
          { h: 'From', w: 110, v: (t) => (t.effective_from ? fmtDate(t.effective_from) : '—') },
          { h: 'Set by', w: 150, v: (t) => (t.updated_by ? people[t.updated_by]?.full_name ?? '' : '—') },
        ]}
      />
    </Screen>
  );
}
