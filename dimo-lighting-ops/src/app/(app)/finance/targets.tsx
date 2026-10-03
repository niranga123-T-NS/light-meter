import { Redirect, router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { pctTone } from '@/components/financeTones';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, NumberField, Pill, Progress, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtMonth, fmtMonthShort, fmtPct, fyLabel, fyMonths, fyOf, isReviewer, lineShort, mn, seesPnl, ytd, type Performance } from '@/lib/finance';
import { fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type TargetRow = { sales_person_id: string; month: string; secured_target: number; invoice_target: number };
type TargetSet = { fy: number; status: 'draft' | 'submitted' | 'approved' | 'returned'; submitted_at: string | null; decided_at: string | null; note: string | null };
const STATUS_LABEL: Record<TargetSet['status'], string> = { draft: 'Draft', submitted: 'Waiting for GM / DGM', approved: 'Approved', returned: 'Returned by GM / DGM' };

/** Sales targets: secured and invoicing per sales person and month; league table. SM Projects sets, GM / DGM approves. */
export default function Targets() {
  const me = useMe();
  const dialog = useDialog();
  const [fy, setFy] = useState(fyOf(todayISO()));
  const [person, setPerson] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { s: number | null; i: number | null }> | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const [perf, t, ts, sales] = await Promise.all([
      rpc<Performance>('finance_performance', { p_fy: fy }),
      supabase.from('sales_targets').select('*').eq('fy', fy),
      supabase.from('target_sets').select('*').eq('fy', fy).maybeSingle(),
      supabase.from('profiles').select('id, full_name').in('role', ['asm_building', 'asm_infra']).eq('active', true).order('full_name'),
    ]);
    return { perf, targets: (t.data ?? []) as TargetRow[], set: (ts.data ?? null) as TargetSet | null, sales: (sales.data ?? []) as { id: string; full_name: string }[] };
  }, [fy]);

  if (isSales(me.role)) return <Redirect href="/finance/my" />;
  if (!seesPnl(me.role)) {
    return (
      <Screen>
        <Notice>Targets are for SM Projects, SM Estimation and GM / DGM.</Notice>
      </Screen>
    );
  }
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { perf } = data;
  const status = data.set?.status ?? 'draft';
  const editable = (status === 'draft' || status === 'returned') && (me.role === 'sm_projects' || me.role === 'gm');
  const upTo = perf.latest_month;
  const people = perf.people.map((p) => ({ p, y: ytd(p, upTo) })).sort((a, b) => b.y.score - a.y.score);
  const tot = people.reduce(
    (a, { y }) => ({ st: a.st + y.securedTarget, s: a.s + y.secured, it: a.it + y.invoiceTarget, i: a.i + y.invoiced, fy: a.fy + y.fyInvoiceTarget, fyi: a.fyi + y.fyInvoiced, tb: a.tb + y.toBill }),
    { st: 0, s: 0, it: 0, i: 0, fy: 0, fyi: 0, tb: 0 },
  );
  const months = fyMonths(fy);
  const years = [fyOf(todayISO()) - 1, fyOf(todayISO()), fyOf(todayISO()) + 1];

  const startEdit = (pid: string) => {
    setPerson(pid);
    setEdit(
      Object.fromEntries(
        months.map((m) => {
          const t = data.targets.find((x) => x.sales_person_id === pid && x.month === m);
          return [m, { s: t ? Number(t.secured_target) : 0, i: t ? Number(t.invoice_target) : 0 }];
        }),
      ),
    );
  };
  const saveEdit = () =>
    dialog.run(async () => {
      await rpc('save_targets', {
        p_fy: fy,
        p_rows: months.map((m) => ({ sales_person_id: person, month: m, secured_target: String(edit![m].s ?? 0), invoice_target: String(edit![m].i ?? 0) })),
      });
      setEdit(null);
      await reload();
    }, 'Targets saved');
  const fill = async () => {
    const ok = await dialog.confirm(
      'Fill targets from the budget list?',
      'Every sales person’s targets for the year are replaced: invoicing = budget invoice months (+ opening secured invoices not in the budget), secured = this-year value of each budgeted project in its order month. You can then adjust them.',
      { confirmLabel: 'Fill' },
    );
    if (!ok) return;
    await dialog.run(async () => {
      await rpc('fill_targets_from_budget', { p_fy: fy });
      await reload();
    }, 'Targets filled from the budget list');
  };
  const submit = () =>
    dialog.run(async () => {
      await rpc('submit_targets', { p_fy: fy });
      await reload();
    }, me.role === 'gm' ? 'Targets approved' : 'Sent to GM / DGM');
  const decide = async (approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the sales targets' : 'Return the targets',
      fields: [{ key: 'note', label: approve ? 'Note (optional)' : 'Reason', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Return',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_targets', { p_fy: fy, p_approve: approve, p_note: r.note || null });
      await reload();
    }, approve ? 'Approved – sales are told' : 'Returned to SM Projects');
  };
  const personTotals = (pid: string) => {
    const ts = data.targets.filter((t) => t.sales_person_id === pid);
    return { s: ts.reduce((a, t) => a + Number(t.secured_target), 0), i: ts.reduce((a, t) => a + Number(t.invoice_target), 0) };
  };

  return (
    <Screen maxWidth={1250}>
      <Stack.Screen options={{ title: 'Sales targets' }} />
      <Row wrap gap={8} style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ width: 200 }}>
          <Select label="Financial year" value={String(fy)} onChange={(v) => setFy(Number(v))} options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))} />
        </View>
        <Row wrap gap={8}>
          <Pill label={`Targets: ${STATUS_LABEL[status]}`} tone={status === 'approved' ? colors.green : status === 'returned' ? colors.red : colors.amber} />
          {editable ? <Button small variant="secondary" title="Fill from budget list" onPress={fill} /> : null}
          {editable && data.targets.length ? <Button small title={me.role === 'gm' ? 'Approve targets' : 'Submit to GM / DGM'} onPress={submit} /> : null}
          {status === 'submitted' && me.role === 'gm' ? (
            <>
              <Button small title="Approve" onPress={() => decide(true)} />
              <Button small variant="secondary" title="Return" onPress={() => decide(false)} />
            </>
          ) : null}
          {status === 'approved' && me.role === 'gm' ? <Button small variant="ghost" title="Re-open for changes" onPress={() => decide(false)} /> : null}
        </Row>
      </Row>
      {data.set?.note ? <Notice tone={status === 'returned' ? colors.red : colors.blue}>{`GM / DGM: ${data.set.note} (${fmtDateTime(data.set.decided_at)})`}</Notice> : null}

      <Grid min={220}>
        <Card>
          <Muted>Secured · Apr – {upTo ? fmtMonthShort(upTo) : '—'}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{mn(tot.s)} Mn</Text>
          <Progress pct={(tot.s / (tot.st || 1)) * 100} colour={pctTone((tot.s / (tot.st || 1)) * 100)} />
          <Muted>{`Target ${mn(tot.st)} · ${fmtPct((tot.s / (tot.st || 1)) * 100)}`}</Muted>
        </Card>
        <Card>
          <Muted>Invoiced · Apr – {upTo ? fmtMonthShort(upTo) : '—'}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{mn(tot.i)} Mn</Text>
          <Progress pct={(tot.i / (tot.it || 1)) * 100} colour={pctTone((tot.i / (tot.it || 1)) * 100)} />
          <Muted>{`Target ${mn(tot.it)} · ${fmtPct((tot.i / (tot.it || 1)) * 100)}`}</Muted>
        </Card>
        <Card>
          <Muted>Cover of the year’s invoicing target</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{fmtPct(((tot.fyi + tot.tb) / (tot.fy || 1)) * 100)}</Text>
          <Muted>{`Invoiced ${mn(tot.fyi)} + secured to bill ${mn(tot.tb)} of ${mn(tot.fy)} · still to win ${mn(Math.max(0, tot.fy - tot.fyi - tot.tb))}`}</Muted>
        </Card>
      </Grid>
      {!upTo ? <Notice tone={colors.amber}>No OR file loaded for this year yet – invoiced shows 0 until Operations uploads it.</Notice> : null}

      <Section title={`Team league · Apr – ${upTo ? fmtMonth(upTo) : '…'} (LKR Mn)`}>
        <DataTable
          rows={people}
          keyOf={(x) => x.p.id}
          onPress={(x) => router.push({ pathname: '/finance/my', params: { person: x.p.id, fy: String(fy) } })}
          emptyTitle="No targets yet – fill them from the budget list"
          footer={['Total', '', mn(tot.st), mn(tot.s), fmtPct((tot.s / (tot.st || 1)) * 100), mn(tot.it), mn(tot.i), fmtPct((tot.i / (tot.it || 1)) * 100), fmtPct(((tot.fyi + tot.tb) / (tot.fy || 1)) * 100), '', '']}
          columns={[
            { h: 'Sales person', w: 170, v: (x) => x.p.name, bold: true },
            { h: 'Lines', w: 90, v: (x) => x.p.lines.map(lineShort).join(', ') || '—' },
            { h: 'Secured target', w: 105, right: true, v: (x) => mn(x.y.securedTarget) },
            { h: 'Secured', w: 85, right: true, v: (x) => mn(x.y.secured) },
            { h: '%', w: 75, v: (x) => <Pill label={fmtPct(x.y.securedPct)} tone={pctTone(x.y.securedPct)} /> },
            { h: 'Invoicing target', w: 110, right: true, v: (x) => mn(x.y.invoiceTarget) },
            { h: 'Invoiced', w: 85, right: true, v: (x) => mn(x.y.invoiced) },
            { h: '% ', w: 75, v: (x) => <Pill label={fmtPct(x.y.invoicedPct)} tone={pctTone(x.y.invoicedPct)} /> },
            { h: 'Cover (FY)', w: 85, right: true, v: (x) => fmtPct(x.y.cover) },
            { h: 'Score', w: 70, right: true, v: (x) => x.y.score.toFixed(1), bold: true },
            { h: 'Awaiting schedule', w: 140, v: (x) => (x.p.pending_n ? <Pill label={`${x.p.pending_n} won · ${mn(x.p.pending_value)}`} tone={colors.amber} /> : '—') },
          ]}
        />
        <Muted>
          Secured = this-year value of each project won (counted once SM Projects approves its invoice schedule). Score = 40% secured + 60% invoiced. Cover = (invoiced + secured still to
          bill this year) ÷ the year’s invoicing target.
          {perf.unlinked_invoiced ? ` ${mn(perf.unlinked_invoiced)} Mn invoiced this year is on WBS codes not linked to a secured project – add the WBS on the project.` : ''}
        </Muted>
      </Section>

      <Section title="Monthly targets">
        <Card>
          <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
            <View style={{ width: 260, maxWidth: '100%' }}>
              <Select
                label="Sales person"
                value={person}
                onChange={(v) => {
                  setEdit(null);
                  setPerson(v);
                }}
                options={data.sales.map((s) => ({ value: s.id, label: s.full_name, hint: `FY ${mn(personTotals(s.id).i)} invoicing · ${mn(personTotals(s.id).s)} secured` }))}
              />
            </View>
            {person && editable && !edit ? <Button small title="Edit months" onPress={() => startEdit(person)} /> : null}
          </Row>
          {person && !edit ? (
            <DataTable
              rows={months}
              keyOf={(m) => m}
              footer={['Year', mn(personTotals(person).s, 2), mn(personTotals(person).i, 2)]}
              columns={[
                { h: 'Month', w: 110, v: (m) => fmtMonth(m) },
                { h: 'Secured target', w: 130, right: true, v: (m) => mn(data.targets.find((t) => t.sales_person_id === person && t.month === m)?.secured_target ?? 0, 2) },
                { h: 'Invoicing target', w: 130, right: true, v: (m) => mn(data.targets.find((t) => t.sales_person_id === person && t.month === m)?.invoice_target ?? 0, 2) },
              ]}
            />
          ) : null}
          {edit ? (
            <View style={{ gap: 4 }}>
              {months.map((m) => (
                <Grid key={m} min={200}>
                  <Text style={{ fontWeight: '600', marginTop: 28, color: colors.ink }}>{fmtMonth(m)}</Text>
                  <NumberField label="Secured target" suffix="LKR" value={edit[m].s} onChange={(v) => setEdit({ ...edit, [m]: { ...edit[m], s: v } })} />
                  <NumberField label="Invoicing target" suffix="LKR" value={edit[m].i} onChange={(v) => setEdit({ ...edit, [m]: { ...edit[m], i: v } })} />
                </Grid>
              ))}
              <Text style={{ fontWeight: '600', color: colors.ink }}>
                Year: secured {mn(Object.values(edit).reduce((a, x) => a + (x.s ?? 0), 0), 2)} Mn · invoicing {mn(Object.values(edit).reduce((a, x) => a + (x.i ?? 0), 0), 2)} Mn
              </Text>
              <Row gap={8}>
                <Button title="Save" onPress={saveEdit} />
                <Button variant="secondary" title="Cancel" onPress={() => setEdit(null)} />
              </Row>
            </View>
          ) : null}
          {!editable && status !== 'approved' && isReviewer(me.role) ? <Muted>Waiting for GM / DGM – targets can be changed again if returned.</Muted> : null}
          {status === 'approved' ? <Muted>Approved targets are locked. GM / DGM can re-open them for changes.</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
