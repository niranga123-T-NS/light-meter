import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { custodyLabel, type ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtNumber, fmtTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

export type Balance = {
  item: string;
  unit: string;
  custody: 'dimo' | 'client' | 'subcontractor';
  custody_company: string | null;
  received: number;
  issued: number;
  returned: number;
  other_out: number;
  balance: number;
  used: number;
  min_qty: number | null;
  ignore_low: boolean;
  low: boolean;
};
export type Issue = {
  id: string;
  code: string;
  day: string;
  item: string;
  unit: string;
  custody: Balance['custody'];
  custody_company: string | null;
  qty: number;
  task_title: string | null;
  issued_to: string | null;
  issued_by: string;
  issued_at: string;
  related: boolean;
  status: 'issued' | 'blocked' | 'pending_ae' | 'pending_see' | 'rejected';
  release_reason: string | null;
  decision_note: string | null;
  used_qty: number | null;
  used_note: string | null;
};
const ISSUE: Record<Issue['status'], { label: string; tone: string }> = {
  issued: { label: 'Issued', tone: colors.green },
  blocked: { label: 'Blocked – not for the task', tone: colors.red },
  pending_ae: { label: 'Special release – with the AE', tone: colors.amber },
  pending_see: { label: 'Special release – with the SEE', tone: colors.amber },
  rejected: { label: 'Not released', tone: colors.grey },
};
const n = (v: number | null | undefined) => fmtNumber(Number(v ?? 0));

/** Site store balances per item and custody, with low-stock warnings the SEE / AE can set a minimum for or ignore. */
export function StoreBalances({ p, aeOfProject }: { p: ExecProject; aeOfProject: boolean }) {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(() => rpc<Balance[]>('store_balances', { p_exec: p.id }), [p.id]);
  const can = me.role === 'senior_elec_engineer' || aeOfProject;
  const rows = data ?? [];
  const warn = rows.filter((b) => b.low && !b.ignore_low);
  const settings = async (b: Balance) => {
    const r = await dialog.prompt({
      title: `${b.item} · ${custodyLabel(b.custody)}`,
      message: `Balance ${n(b.balance)} ${b.unit}. A warning shows when the balance falls to the minimum (default: 20% of what was received). Ignore it when the project needs no more of this item.`,
      fields: [
        { key: 'm', label: `Minimum stock (${b.unit}) – blank = 20% of received`, initial: b.min_qty != null ? String(b.min_qty) : '' },
        { key: 'i', label: 'Low-stock warning', type: 'select', required: true, initial: b.ignore_low ? 'ignore' : 'show', options: [{ value: 'show', label: 'Show the warning' }, { value: 'ignore', label: 'Ignore – no further order needed' }] },
        { key: 'n', label: 'Note (why no further order)', type: 'multiline' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('set_store_item', { p_exec: p.id, p_item: b.item, p_custody: b.custody, p_min: r.m ? Number(r.m) : null, p_ignore: r.i === 'ignore', p_note: r.n || null });
      await reload();
    }, 'Saved');
  };
  return (
    <Section title={`Site store – balances (${rows.length})`}>
      {warn.length ? <Notice tone={colors.amber}>{`Low stock: ${warn.map((b) => `${b.item} (${n(b.balance)} ${b.unit})`).join(' · ')}`}</Notice> : null}
      <DataTable
        rows={rows}
        keyOf={(b) => `${b.item}|${b.custody}|${b.custody_company ?? ''}`}
        emptyTitle="Nothing received yet – deliveries come into the store"
        columns={[
          { h: 'Item', w: 220, v: (b) => b.item, bold: true },
          { h: 'Custody', w: 170, v: (b) => `${custodyLabel(b.custody)}${b.custody_company ? ` · ${b.custody_company}` : ''}` },
          { h: 'Received', w: 90, right: true, v: (b) => n(b.received) },
          { h: 'Issued', w: 80, right: true, v: (b) => n(b.issued) },
          { h: 'Used', w: 80, right: true, v: (b) => n(b.used) },
          { h: 'Back', w: 70, right: true, v: (b) => n(b.returned) },
          { h: 'Balance', w: 110, right: true, v: (b) => `${n(b.balance)} ${b.unit}`, bold: true, tone: (b) => (b.low && !b.ignore_low ? colors.red : undefined) },
          {
            h: '',
            w: can ? 220 : 130,
            v: (b) => (
              <Row gap={4} style={{ alignItems: 'center' }}>
                {b.low ? <Pill label={b.ignore_low ? 'Low – ignored' : 'Low stock'} tone={b.ignore_low ? colors.grey : colors.red} /> : null}
                {can ? <Button small variant="ghost" title={b.low && !b.ignore_low ? 'Ignore / minimum' : 'Minimum'} onPress={() => settings(b)} /> : null}
              </Row>
            ),
          },
        ]}
      />
    </Section>
  );
}

type Task = { kind: 'sub' | 'ae'; id: string; title: string };

/** Materials issued to the staff against the day's task: blocked when not for the task, special release (AE, then the SEE for
 *  client's material), and the day's usage – what was not used goes back to the store. */
export function MaterialIssues({ p, aeOfProject, onChange }: { p: ExecProject; aeOfProject: boolean; onChange?: () => void }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const sub = me.role === 'sub_supervisor';
  const today = todayISO();
  const [days, setDays] = useState(7);
  const { data, reload } = useLoad(async () => {
    const [iss, bal, subT, aeT] = await Promise.all([
      supabase.from('material_issues').select('*').eq('exec_project_id', p.id).gte('day', addDaysISO(today, -days)).order('issued_at', { ascending: false }),
      rpc<Balance[]>('store_balances', { p_exec: p.id }),
      sub
        ? supabase.from('sub_plan_items').select('id, title, sub_plans!inner(supervisor_id, exec_project_id, status)').eq('day', today)
            .eq('sub_plans.supervisor_id', me.id).eq('sub_plans.exec_project_id', p.id).eq('sub_plans.status', 'approved')
        : Promise.resolve({ data: [] }),
      aeOfProject ? supabase.from('exec_plan_items').select('id, title').eq('exec_project_id', p.id).eq('day', today) : Promise.resolve({ data: [] }),
    ]);
    const tasks: Task[] = [
      ...((subT.data ?? []) as { id: string; title: string }[]).map((t) => ({ kind: 'sub' as const, id: t.id, title: t.title })),
      ...((aeT.data ?? []) as { id: string; title: string }[]).map((t) => ({ kind: 'ae' as const, id: t.id, title: t.title })),
    ];
    return { issues: (iss.data ?? []) as Issue[], balances: bal, tasks };
  }, [p.id, days, me.id]);
  const issues = data?.issues ?? [];
  const canIssue = sub || aeOfProject;
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
      onChange?.();
    }, ok);

  const issue = async () => {
    const stock = (data?.balances ?? []).filter((b) => b.balance > 0);
    if (!data?.tasks.length) return dialog.toast('No task for you today – materials are issued against the day’s task (approved plan)', 'error');
    if (!stock.length) return dialog.toast('Nothing in the site store', 'error');
    const r = await dialog.prompt({
      title: 'Issue material to the staff',
      message: 'Only material for the task is released at once; anything else is blocked and the AE and the SEE are alerted.',
      fields: [
        { key: 't', label: 'Today’s task', type: 'select', required: true, options: data.tasks.map((t) => ({ value: `${t.kind}|${t.id}`, label: t.title })) },
        {
          key: 'i',
          label: 'Material',
          type: 'select',
          required: true,
          options: stock.map((b) => ({ value: `${b.item}||${b.custody}||${b.custody_company ?? ''}`, label: `${b.item} · ${n(b.balance)} ${b.unit} · ${custodyLabel(b.custody)}${b.custody_company ? ` (${b.custody_company})` : ''}` })),
        },
        { key: 'q', label: 'Quantity', required: true },
        { key: 'w', label: 'Issued to (staff / gang)', required: true },
        { key: 'n', label: 'Note' },
      ],
      confirmLabel: 'Issue',
    });
    if (!r) return;
    const [kind, id] = r.t.split('|');
    const [item, custody, company] = r.i.split('||');
    await dialog.run(async () => {
      const out = await rpc<{ status: string }>('issue_material', {
        p_exec: p.id,
        p: { task_kind: kind, task_id: id, item, custody, custody_company: company || null, qty: r.q, issued_to: r.w, note: r.n || null },
      });
      await reload();
      onChange?.();
      if (out.status === 'blocked') throw new Error('Blocked – this material is not for the task. The AE and the SEE are alerted; ask for a special release if it is still needed.');
    }, 'Issued');
  };
  const usage = async (i: Issue) => {
    const r = await dialog.prompt({
      title: `Usage – ${i.item}`,
      message: `${n(i.qty)} ${i.unit} issued for “${i.task_title ?? ''}”. What was not used goes back to the store.`,
      fields: [
        { key: 'u', label: `Used (${i.unit})`, required: true, initial: String(i.qty) },
        { key: 'n', label: 'Used for (where / what)', type: 'multiline', required: true, initial: i.task_title ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await run('report_material_usage', { p_id: i.id, p_used: Number(r.u), p_note: r.n }, 'Usage recorded');
  };
  const askRelease = async (i: Issue) => {
    const r = await dialog.prompt({
      title: 'Ask for a special release',
      message: i.custody === 'client' ? 'Client’s material: the AE and then the SEE clear it.' : 'The AE clears it.',
      fields: [{ key: 'r', label: 'Why it is needed for today’s work', type: 'multiline', required: true }],
      confirmLabel: 'Ask',
    });
    if (r) await run('request_issue_release', { p_id: i.id, p_reason: r.r }, 'Sent for clearance');
  };
  const decide = async (i: Issue, ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? 'Clear the release' : 'Do not release',
      fields: [{ key: 'n', label: ok ? 'Note' : 'Reason', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Clear' : 'Refuse',
      danger: !ok,
    });
    if (r) await run('decide_issue_release', { p_id: i.id, p_ok: ok, p_note: r.n || null }, ok ? 'Cleared' : 'Refused');
  };

  const pendingUsage = issues.filter((i) => i.status === 'issued' && i.used_qty == null && i.issued_by === me.id);
  const byDay = [...new Set(issues.map((i) => i.day))];
  return (
    <Section title="Materials issued to the work" right={canIssue && p.status === 'active' ? <Button small title="+ Issue material" onPress={issue} /> : null}>
      {pendingUsage.length ? (
        <Notice tone={colors.amber}>{`Record the usage of ${pendingUsage.length} issue${pendingUsage.length === 1 ? '' : 's'} – needed before the daily report.`}</Notice>
      ) : null}
      {byDay.length ? (
        byDay.map((d) => (
          <View key={d} style={{ gap: 4, marginBottom: 8 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{`${fmtDate(d)}${d === today ? ' · today' : ''}`}</Text>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {issues
                .filter((i) => i.day === d)
                .map((i) => {
                  const mine = i.issued_by === me.id;
                  const aeTurn = i.status === 'pending_ae' && aeOfProject;
                  const seeTurn = i.status === 'pending_see' && me.role === 'senior_elec_engineer';
                  return (
                    <ListRow
                      key={i.id}
                      wrapRight
                      highlight={i.status === 'blocked' ? colors.red : i.status.startsWith('pending') ? colors.amber : undefined}
                      title={`${i.item} · ${n(i.qty)} ${i.unit}`}
                      subtitle={[
                        `${i.code} · ${custodyLabel(i.custody)} · for “${i.task_title ?? ''}”`,
                        `${i.issued_to ? `to ${i.issued_to} · ` : ''}by ${people[i.issued_by]?.full_name ?? ''} · ${fmtTime(i.issued_at)}`,
                        i.release_reason ? `Reason: ${i.release_reason}` : null,
                        i.decision_note ? `Note: ${i.decision_note}` : null,
                        i.used_qty != null ? `Used ${n(i.used_qty)}${Number(i.qty) - Number(i.used_qty) > 0 ? ` · ${n(Number(i.qty) - Number(i.used_qty))} back to the store` : ''} · ${i.used_note ?? ''}` : null,
                      ]
                        .filter(Boolean)
                        .join('\n')}
                      right={
                        <Row gap={4} wrap style={{ alignItems: 'center' }}>
                          <Pill label={ISSUE[i.status].label} tone={ISSUE[i.status].tone} />
                          {i.status === 'issued' && i.used_qty == null && (mine || aeOfProject) ? <Button small title="Record usage" onPress={() => usage(i)} /> : null}
                          {i.status === 'blocked' && mine ? <Button small variant="secondary" title="Ask special release" onPress={() => askRelease(i)} /> : null}
                          {aeTurn || seeTurn ? (
                            <>
                              <Button small title="Clear" onPress={() => decide(i, true)} />
                              <Button small variant="ghost" title="Refuse" onPress={() => decide(i, false)} />
                            </>
                          ) : null}
                        </Row>
                      }
                    />
                  );
                })}
            </Card>
          </View>
        ))
      ) : (
        <Empty title="No materials issued" hint={canIssue ? 'Issue materials to the staff against today’s task' : undefined} />
      )}
      {issues.length ? <Button small variant="ghost" title={days === 7 ? 'Show 30 days' : 'Show 7 days'} onPress={() => setDays(days === 7 ? 30 : 7)} /> : null}
      {canIssue ? <Muted>Material is issued against today’s task. Anything not for the task is blocked; a special release is cleared by the AE (and the SEE too for the client’s material).</Muted> : null}
    </Section>
  );
}
