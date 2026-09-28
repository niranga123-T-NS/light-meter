// Settings (administrators) and exchange rates (managers).
import { Stack } from 'expo-router';
import { useState } from 'react';

import { FormModal } from '@/components/FormModal';
import { DateField, NumberField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, ListItem, Muted, Screen, SectionTitle } from '@/components/ui';
import { refreshCache, useLookup } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDate, todayIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import { useAsync } from '@/lib/useAsync';

interface SettingRow { key: string; value: unknown; description: string | null }
interface Rate { id?: string; currency: string; rate_to_base: number | null; effective_date: string | null; source?: string | null }

export default function Settings() {
  const { isAdmin, profile } = useSession();
  const currencies = useLookup('currency');
  const [editing, setEditing] = useState<{ key: string; text: string; description: string | null } | null>(null);
  const [rate, setRate] = useState<Rate | null>(null);
  const settings = useAsync(async () => unwrap(await supabase.from('app_settings').select('*').order('key')) as SettingRow[], []);
  const rates = useAsync(async () => unwrap(await supabase.from('exchange_rates').select('*').order('effective_date', { ascending: false }).limit(100)) as Rate[], []);
  const base = (settings.data?.find((s) => s.key === 'base_currency')?.value as string) ?? 'LKR';

  const saveSetting = async () => {
    if (!editing) return;
    let value: unknown;
    try {
      value = JSON.parse(editing.text);
    } catch {
      return notify('Invalid value', 'Use JSON: numbers as 30, text in "quotes", true/false, lists as ["a","b"].');
    }
    const { error } = await supabase.from('app_settings').update({ value }).eq('key', editing.key);
    if (error) return notify('Not saved', errorMessage(error));
    setEditing(null);
    await settings.reload();
    await refreshCache(profile!.id).catch(() => undefined);
  };

  const saveRate = async () => {
    if (!rate?.rate_to_base || !rate.effective_date) return;
    const { error } = await supabase.from('exchange_rates').upsert({ ...rate, currency: rate.currency.toUpperCase() }, { onConflict: 'currency,effective_date' });
    if (error) return notify('Not saved', errorMessage(error));
    setRate(null);
    void rates.reload();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Settings' }} />
      <SectionTitle right={<Button small variant="ghost" title="＋ Rate" onPress={() => setRate({ currency: 'USD', rate_to_base: null, effective_date: todayIso() })} />}>
        {`Exchange rates to ${base}`}
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(rates.data ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No rates. Amounts in other currencies are excluded from {base} totals until a rate exists.</Muted>
          : rates.data!.map((r) => <ListItem key={r.id} title={`1 ${r.currency} = ${r.rate_to_base} ${base}`} subtitle={`From ${fmtDate(r.effective_date)}${r.source ? ` · ${r.source}` : ''}`} onPress={() => setRate(r)} />)}
      </Card>
      <Muted>The rate used is the latest one on or before the relevant date. Totals never add different currencies without a rate.</Muted>

      {isAdmin ? (
        <>
          <SectionTitle>Application settings</SectionTitle>
          {settings.error ? <Banner tone="danger" message={settings.error} /> : null}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(settings.data ?? []).map((s) => (
              <ListItem key={s.key} title={s.key} subtitle={s.description} meta={JSON.stringify(s.value)}
                onPress={() => setEditing({ key: s.key, text: JSON.stringify(s.value), description: s.description })} />
            ))}
          </Card>
        </>
      ) : null}

      <FormModal visible={!!editing} title={editing?.key ?? ''} onClose={() => setEditing(null)} onSave={saveSetting}>
        {editing ? (
          <>
            <Muted>{editing.description}</Muted>
            <TextField label="Value (JSON)" value={editing.text} autoCapitalize="none" onChange={(t) => setEditing({ ...editing, text: t })} multiline />
          </>
        ) : null}
      </FormModal>
      <FormModal visible={!!rate} title="Exchange rate" onClose={() => setRate(null)} onSave={saveRate} saveDisabled={!rate?.rate_to_base || !rate?.effective_date}>
        {rate ? (
          <>
            <SelectField label="Currency" value={rate.currency} options={currencies.filter((c) => c.value !== base)} allowClear={false} onChange={(x) => setRate({ ...rate, currency: x ?? rate.currency })} />
            <NumberField label={`${base} per 1 unit`} value={rate.rate_to_base} onChange={(n) => setRate({ ...rate, rate_to_base: n })} />
            <DateField label="Effective from" value={rate.effective_date} onChange={(d) => setRate({ ...rate, effective_date: d })} />
            <TextField label="Source" value={rate.source} onChange={(t) => setRate({ ...rate, source: t })} placeholder="e.g. CBSL indicative rate" />
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
