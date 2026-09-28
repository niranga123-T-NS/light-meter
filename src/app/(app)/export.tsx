// Excel export: on demand (any role; rows limited to what the user may see)
// and scheduled exports (managers).
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { FormModal } from '@/components/FormModal';
import { SelectField, SwitchField, TextField } from '@/components/form';
import { presetRange, ReportFilterBar } from '@/components/ReportFilters';
import { Badge, Banner, Button, Card, ListItem, Muted, Screen, SectionTitle } from '@/components/ui';
import { profileName } from '@/lib/cache';
import { confirm, notify } from '@/lib/dialog';
import { exportWorkbook } from '@/lib/export';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { ReportFilters } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

interface Schedule { id?: string; name: string; frequency: 'daily' | 'weekly' | 'monthly'; recipients: string[]; active: boolean; filters: Record<string, unknown>; last_run_at?: string | null }

const PERIODS = [
  { value: 'previous_day', label: 'Previous day' }, { value: 'previous_7_days', label: 'Previous 7 days' },
  { value: 'previous_month', label: 'Previous calendar month' }, { value: 'month_to_date', label: 'Month to date' },
  { value: 'year_to_date', label: 'Year to date' },
];

export default function ExportScreen() {
  const params = useLocalSearchParams<ReportFilters & Record<string, string>>();
  const { profile, isManager } = useSession();
  const [filters, setFilters] = useState<ReportFilters>({
    ...presetRange('month'),
    ...Object.fromEntries(Object.entries(params).filter(([k, v]) => ['from', 'to', 'owner_id', 'territory_id', 'stage_id'].includes(k) && v)),
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  const history = useAsync(async () => unwrap(await supabase.from('export_log').select('*').order('created_at', { ascending: false }).limit(20)) as
    { id: string; user_id: string; created_at: string; channel: string; row_counts: Record<string, number>; filters: Record<string, string>; storage_path: string | null }[], []);
  const schedules = useAsync(async () => (isManager ? unwrap(await supabase.from('export_schedules').select('*').order('name')) as Schedule[] : []), [isManager]);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await exportWorkbook(filters, profile!.full_name);
      setResult(`${r.fileName} – ${Object.entries(r.rows).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      void history.reload();
    } catch (e) {
      notify('Export failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    if (!schedule) return;
    const { error } = await supabase.from('export_schedules').upsert(schedule);
    if (error) return notify('Not saved', errorMessage(error));
    setSchedule(null);
    void schedules.reload();
  };

  const download = async (path: string) => {
    const res = await supabase.storage.from('exports').createSignedUrl(path, 300);
    if (res.data?.signedUrl) void Linking.openURL(res.data.signedUrl);
    else notify('Could not open the file', errorMessage(res.error));
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Excel export' }} />
      <Card>
        <ReportFilterBar value={filters} onChange={setFilters} />
        <Muted>
          The workbook has a Read Me sheet, a Summary sheet matching the dashboard, and one flat sheet per record type (Customers, Contacts,
          Visits, Visit Contacts, Projects, Opportunities, Project Stakeholders, Actions, Quotations, Audit Log) with stable column names and IDs.
          Only records you are allowed to see are included.
        </Muted>
        <Button title="Create Excel workbook" onPress={run} loading={busy} />
        {result ? <Banner tone="success" message={result} /> : null}
      </Card>

      {isManager ? (
        <>
          <SectionTitle right={<Button small variant="ghost" title="＋ Schedule" onPress={() => setSchedule({ name: '', frequency: 'weekly', recipients: [], active: true, filters: { period: 'previous_7_days' } })} />}>
            Scheduled exports
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {(schedules.data ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No schedules. Scheduled workbooks are emailed as a secure 7-day link.</Muted> : schedules.data!.map((s) => (
              <ListItem key={s.id} title={s.name} subtitle={`${s.frequency} · ${PERIODS.find((p) => p.value === s.filters.period)?.label ?? 'custom'} · ${s.recipients.join(', ') || 'no email'}`}
                meta={s.last_run_at ? `Last run ${fmtDateTime(s.last_run_at)}` : 'Not run yet'}
                right={<Badge label={s.active ? 'Active' : 'Paused'} tone={s.active ? 'success' : 'neutral'} />} onPress={() => setSchedule(s)} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Recent exports</SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(history.data ?? []).map((h) => (
          <ListItem key={h.id} title={`${fmtDateTime(h.created_at)} · ${h.channel}`}
            subtitle={`${profileName(h.user_id)} · ${h.filters?.from ?? 'start'} → ${h.filters?.to ?? 'today'}`}
            meta={`${h.row_counts?.visits ?? 0} visits · ${h.row_counts?.opportunities ?? 0} packages`}
            onPress={h.storage_path ? () => download(h.storage_path!) : undefined} />
        ))}
      </Card>

      <FormModal visible={!!schedule} title="Scheduled export" onClose={() => setSchedule(null)} onSave={saveSchedule} saveDisabled={!schedule?.name.trim()}>
        {schedule ? (
          <>
            <TextField label="Name" required value={schedule.name} onChange={(t) => setSchedule({ ...schedule, name: t })} />
            <SelectField label="Frequency" value={schedule.frequency} allowClear={false}
              options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]}
              onChange={(x) => setSchedule({ ...schedule, frequency: (x ?? 'weekly') as Schedule['frequency'] })} />
            <SelectField label="Period covered" value={schedule.filters.period as string} options={PERIODS} allowClear={false}
              onChange={(x) => setSchedule({ ...schedule, filters: { ...schedule.filters, period: x } })} />
            <TextField label="Email recipients" value={schedule.recipients.join(', ')} autoCapitalize="none" keyboardType="email-address"
              onChange={(t) => setSchedule({ ...schedule, recipients: t.split(/[,;\s]+/).filter(Boolean) })} hint="Comma separated" />
            <SwitchField label="Active" value={schedule.active} onChange={(x) => setSchedule({ ...schedule, active: x })} />
            <Muted>The workbook is built with your permissions and saved in secure storage. Recipients get a link valid for 7 days.</Muted>
            {schedule.id ? (
              <Button variant="danger" title="Delete schedule" onPress={async () => {
                if (!(await confirm('Delete schedule?', schedule.name, 'Delete', true))) return;
                await supabase.from('export_schedules').delete().eq('id', schedule.id!);
                setSchedule(null);
                void schedules.reload();
              }} />
            ) : null}
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
