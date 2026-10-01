import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { daysFrom, RETENTION_FORMS, retentionStage, STAGE_LABEL } from '@/lib/retentions';
import { rpc, supabase } from '@/lib/supabase';
import type { Retention } from '@/lib/types';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null };

const STAGE_TONE: Record<string, string> = {
  not_due: colors.blue,
  due_soon: colors.amber,
  due: colors.red,
  claimed: colors.blue,
  claim_overdue: colors.red,
  collected: colors.green,
  cancelled: colors.grey,
};

export default function RetentionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [{ data: r, error: e }, { data: log }, { data: pending }] = await Promise.all([
      supabase.from('retentions').select('*').eq('id', id).single(),
      supabase.from('retention_log').select('*').eq('retention_id', id).order('at', { ascending: false }),
      supabase.from('approvals').select('id, reason').eq('kind', 'retention_extension').eq('entity_id', id).eq('status', 'pending'),
    ]);
    if (e) throw new Error(e.message);
    return { r: r as Retention, log: (log ?? []) as Log[], pending: (pending ?? []) as { id: string; reason: string }[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const r = data.r;
  const today = todayISO();
  const stage = retentionStage(r, today);
  const manager = ['operations_exec', 'sm_projects', 'gm'].includes(me.role);
  const canAct = manager || r.sales_person_id === me.id;
  const open = r.status === 'held' || r.status === 'claimed';
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: r.code }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: STAGE_TONE[stage] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{r.project_name}</Text>
          <Pill label={STAGE_LABEL[stage]} tone={STAGE_TONE[stage]} solid />
        </Row>
        <Muted>
          {r.end_client}
          {r.main_contractor ? ` · main contractor ${r.main_contractor}` : ''}
        </Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Retention value" value={fmtMoney(r.retention_value, r.currency)} />
          <KeyValue label="Retention %" value={r.retention_pct != null ? `${r.retention_pct}%` : '—'} />
          <KeyValue label="Contract value" value={r.contract_value != null ? fmtMoney(r.contract_value, r.currency) : '—'} />
          <KeyValue label="Contract / PO no." value={r.contract_no ?? '—'} />
          <KeyValue label="Retention form" value={`${RETENTION_FORMS.find((x) => x.value === r.retention_form)?.label ?? r.retention_form}${r.bg_expiry ? ` · expires ${fmtDate(r.bg_expiry)}` : ''}`} />
          <KeyValue label="Start date" value={fmtDate(r.start_date)} />
          <KeyValue
            label="Due date"
            value={`${fmtDate(r.due_date)}${open ? ` (${r.due_date >= today ? `in ${daysFrom(today, r.due_date)} days` : `${daysFrom(r.due_date, today)} days ago`})` : ''}${r.extensions ? ` · extended ${r.extensions}× (originally ${fmtDate(r.original_due_date)})` : ''}`}
          />
          <KeyValue label="Sales person" value={people[r.sales_person_id ?? '']?.full_name ?? '—'} />
          {r.claimed_on ? <KeyValue label="Claimed" value={`${fmtDate(r.claimed_on)}${r.claim_ref ? ` · ${r.claim_ref}` : ''}`} /> : null}
          {r.collected_on ? <KeyValue label="Collected" value={`${fmtMoney(r.collected_amount, r.currency)} on ${fmtDate(r.collected_on)}`} /> : null}
        </Row>
        {r.notes ? <Muted>{r.notes}</Muted> : null}
        {stage === 'due' ? <Notice tone={colors.red}>Due date reached – claim the retention now (or request an extension). A reminder is sent every day.</Notice> : null}
        {stage === 'claim_overdue' ? <Notice tone={colors.red}>Claimed {daysFrom(r.claimed_on as string, today)} days ago and not yet collected – follow up with the client.</Notice> : null}
        {data.pending.length ? <Notice tone={colors.amber}>Extension waiting for GM / DGM: {data.pending[0].reason}</Notice> : null}
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {canAct && r.status === 'held' ? (
            <Button
              title="Mark claimed"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Retention claimed',
                  fields: [
                    { key: 'd', label: 'Claim date', type: 'date', required: true, initial: today },
                    { key: 'ref', label: 'Claim / invoice reference' },
                    { key: 'n', label: 'Note', type: 'multiline' },
                  ],
                });
                if (x) await run('mark_retention_claimed', { p_id: r.id, p_on: x.d, p_ref: x.ref || null, p_note: x.n || null }, 'Marked claimed');
              }}
            />
          ) : null}
          {canAct && open ? (
            <Button
              variant={r.status === 'claimed' ? 'primary' : 'secondary'}
              title="Mark collected"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Retention collected',
                  fields: [
                    { key: 'a', label: `Amount collected (${r.currency})`, required: true, initial: String(r.retention_value) },
                    { key: 'd', label: 'Collection date', type: 'date', required: true, initial: today },
                    { key: 'n', label: 'Note', type: 'multiline' },
                  ],
                });
                if (!x) return;
                const amount = Number(String(x.a).replace(/,/g, ''));
                if (!(amount > 0)) return dialog.toast('Enter the amount collected', 'error');
                await run('mark_retention_collected', { p_id: r.id, p_amount: amount, p_on: x.d, p_note: x.n || null }, 'Marked collected');
              }}
            />
          ) : null}
          {canAct && open && !data.pending.length ? (
            <Button
              variant="secondary"
              title="Extend due date"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Extend the due date (GM / DGM approves)',
                  fields: [
                    { key: 'd', label: 'New due date', type: 'date', required: true },
                    { key: 'r', label: 'Reason', type: 'multiline', required: true },
                  ],
                });
                if (!x) return;
                if (x.d <= r.due_date) return dialog.toast('The new due date must be after the current due date', 'error');
                await run('request_retention_extension', { p_id: r.id, p_new_due: x.d, p_reason: x.r }, 'Sent to GM / DGM for approval');
              }}
            />
          ) : null}
          {manager && open ? <Button variant="secondary" title="Edit details" onPress={() => router.push({ pathname: '/retentions/edit', params: { id: r.id } })} /> : null}
          {manager && open ? (
            <Button
              variant="ghost"
              title="Cancel record"
              onPress={async () => {
                const x = await dialog.prompt({ title: 'Cancel this retention record', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }], danger: true });
                if (x) await run('cancel_retention', { p_id: r.id, p_reason: x.r }, 'Cancelled');
              }}
            />
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="retention" entityId={r.id} kinds={['retention_doc']} title="Documents (contract clause, certificates, claim letter, bank guarantee, payment proof)" canUpload={canAct} allowCamera />
      <Section title="History">
        <Card>
          {data.log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id ?? '']?.full_name ?? 'System'} · {l.note ?? l.kind}
            </Muted>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
