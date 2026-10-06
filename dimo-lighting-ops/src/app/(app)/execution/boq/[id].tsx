import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useShellCounts } from '@/components/AppShell';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { BILLING_ROLES } from '@/lib/billing';
import { BOQ_STATUS, bySection, readBoqFile, type Boq, type BoqItem, type ParsedBoq } from '@/lib/boq';
import type { ExecProject } from '@/lib/execution';
import { pickDocument } from '@/lib/files';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const tone = { amber: colors.amber, green: colors.green, red: colors.red };

/** Contract BOQ of an execution project: upload (one sheet or split into bills), check against the order value, SM Projects approves. */
export default function BoqScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { refresh } = useShellCounts();
  const [parsed, setParsed] = useState<ParsedBoq | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const { data, error, reload } = useLoad(async () => {
    const [p, b, i] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('id', id).single(),
      supabase.from('exec_boqs').select('*').eq('exec_project_id', id).maybeSingle(),
      supabase.from('exec_boq_items').select('*').eq('exec_project_id', id).order('seq'),
    ]);
    if (p.error) throw new Error(p.error.message);
    const ep = p.data as ExecProject;
    const s = ep.secured_id ? await supabase.from('secured_projects').select('order_value').eq('id', ep.secured_id).maybeSingle() : { data: null };
    const order = (s.data as { order_value: number | null } | null)?.order_value ?? ep.contract_value_lkr;
    return { p: ep, boq: b.data as Boq | null, items: (i.data ?? []) as BoqItem[], order: order == null ? null : Number(order) };
  }, [id]);

  if (!BILLING_ROLES.includes(me.role)) return <Screen><Notice>The contract BOQ is kept with the Senior Electrical Engineer, SM Projects, GM and Operations.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { p, boq, items, order } = data;
  const canUpload = me.role === 'senior_elec_engineer' || me.role === 'operations_exec';
  const st = boq ? BOQ_STATUS[boq.status] : null;

  const choose = async () => {
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      setParsed(await readBoqFile(file));
      setSkip([]);
    });
  };
  const included = parsed ? parsed.sheets.filter((s) => !s.skipped && !skip.includes(s.name)) : [];
  const newTotal = included.reduce((t, s) => t + s.total, 0);

  const save = async () => {
    if (!parsed || !included.length) return;
    const res = await dialog.prompt({
      title: boq?.version ? 'Revised contract BOQ' : 'Send the BOQ to SM Projects',
      message: `${included.reduce((t, s) => t + s.items.length, 0)} rows · ${fmtMoney(newTotal, 'LKR')}${order ? ` · order value ${fmtMoney(order, 'LKR')}` : ''}`,
      fields: [
        { key: 'mos', label: 'Material on Site % paid by the contract (0 if not paid)', initial: String(boq?.mos_pct ?? 0) },
        ...(boq?.version ? [{ key: 'note', label: 'Reason for the revision', type: 'multiline' as const, required: true }] : [{ key: 'note', label: 'Note', type: 'multiline' as const }]),
      ],
      confirmLabel: 'Send to SM Projects',
    });
    if (!res) return;
    await dialog.run(async () => {
      await rpc('save_boq', {
        p_exec: id,
        p_items: included.flatMap((s) => s.items),
        p_file: parsed.fileName,
        p_sheets: included.map((s) => s.name),
        p_mos_pct: Number(res.mos || 0),
        p_note: res.note || null,
      });
      setParsed(null);
      await reload();
    }, 'Sent to SM Projects');
  };

  const setMos = async () => {
    const res = await dialog.prompt({
      title: 'Material on Site',
      message: 'The % of the BOQ rate the contract pays for materials delivered to site and not yet installed. SM Projects approves the change.',
      fields: [
        { key: 'mos', label: 'Material on Site %', required: true, initial: String(boq?.mos_pct ?? 0) },
        ...(boq?.version ? [{ key: 'note', label: 'Reason', type: 'multiline' as const, required: true }] : []),
      ],
      confirmLabel: 'Save',
    });
    if (res) await dialog.run(async () => { await rpc('set_boq_mos', { p_exec: id, p_pct: Number(res.mos), p_note: res.note || null }); await reload(); }, 'Sent to SM Projects');
  };

  const decide = async (ok: boolean) => {
    const res = await dialog.prompt({
      title: ok ? 'Approve the contract BOQ' : 'Return the BOQ',
      message: ok && order && boq && Math.abs(boq.total - order) > 1 ? `The BOQ total differs from the order value by ${fmtMoney(boq.total - order, 'LKR')}.` : undefined,
      fields: [{ key: 'note', label: ok ? 'Note' : 'What to correct', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Approve' : 'Return',
      danger: !ok,
    });
    if (res)
      await dialog.run(async () => {
        await rpc('decide_boq', { p_exec: id, p_approve: ok, p_note: res.note || null });
        await reload();
        refresh();
      }, ok ? 'Approved – the AEs can measure against it' : 'Returned');
  };

  const live = items.filter((i) => !i.removed);
  const diff = boq && order != null ? boq.total - order : null;

  return (
    <Screen onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: 'Contract BOQ' }} />
      <TestingBanner what="The contract BOQ" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{p.name}</Text>
      <Muted>{[p.code, boq?.file_name, boq?.sheets?.length ? `${boq.sheets.length} bill(s)` : null].filter(Boolean).join(' · ')}</Muted>

      {boq ? (
        <>
          <Row wrap gap={6}>
            {st ? <Pill label={st.label} tone={tone[st.tone]} solid={boq.status === 'approved'} /> : null}
            {boq.version ? <Pill label={`Baseline ${boq.version}`} /> : null}
            <Pill label={boq.mos_pct > 0 ? `Material on Site ${fmtNumber(boq.mos_pct, 0)}%` : 'Material on Site not paid'} tone={boq.mos_pct > 0 ? colors.blue : colors.grey} />
          </Row>
          <Grid min={170}>
            <Stat label="BOQ total" value={fmtMoney(boq.total, 'LKR')} />
            <Stat label="Order value" value={order != null ? fmtMoney(order, 'LKR') : '—'} />
            <Stat label="Difference" value={diff != null ? fmtMoney(diff, 'LKR') : '—'} tone={diff != null && Math.abs(diff) > 1 ? 'amber' : 'green'} />
            <Stat label="Items" value={String(live.filter((i) => !i.heading).length)} />
          </Grid>
          {boq.submit_note ? <Muted>{`Note: ${boq.submit_note}`}</Muted> : null}
          <Muted>{`Uploaded by ${people[boq.uploaded_by ?? '']?.full_name ?? ''} · ${fmtDateTime(boq.uploaded_at)}${boq.decided_at ? ` · ${boq.status === 'returned' ? 'returned' : 'approved'} by ${people[boq.decided_by ?? '']?.full_name ?? ''} ${fmtDateTime(boq.decided_at)}` : ''}`}</Muted>
          {boq.status === 'returned' && boq.decision_note ? <Notice tone={colors.red}>{`Returned: ${boq.decision_note}`}</Notice> : null}
          {boq.status === 'submitted' && me.role === 'sm_projects' ? (
            <Row gap={8}>
              <Button title="Approve" onPress={() => decide(true)} />
              <Button title="Return" variant="secondary" onPress={() => decide(false)} />
            </Row>
          ) : null}
        </>
      ) : (
        <Notice tone={colors.amber}>No BOQ yet. Upload the priced BOQ from the contract (Excel) – one sheet, or one sheet per bill.</Notice>
      )}

      {canUpload ? (
        <Row gap={8} wrap>
          <Button title={boq ? 'Upload a revised BOQ' : 'Upload BOQ (Excel)'} onPress={choose} />
          {boq ? <Button title="Material on Site %" variant="secondary" onPress={setMos} /> : null}
        </Row>
      ) : null}

      {parsed ? (
        <Section title={`Check before sending – ${parsed.fileName}`}>
          <Muted>Each sheet with Description, Qty and Rate headings is read as a bill. Total, sub-total and carried-forward rows are left out. Tap a sheet to leave it out.</Muted>
          <Card style={{ gap: 6 }}>
            {parsed.sheets.map((s) => (
              <Row key={s.name} gap={8} wrap style={{ alignItems: 'center' }}>
                {s.skipped ? (
                  <Chip label={s.name} />
                ) : (
                  <Chip label={s.name} on={!skip.includes(s.name)} onPress={() => setSkip((x) => (x.includes(s.name) ? x.filter((n) => n !== s.name) : [...x, s.name]))} />
                )}
                <Muted>{s.skipped ? `Skipped – ${s.skipped}` : `${s.items.filter((i) => i.qty != null).length} items · ${fmtMoney(s.total, 'LKR')}`}</Muted>
              </Row>
            ))}
          </Card>
          <Grid min={170}>
            <Stat label="Total of the bills included" value={fmtMoney(newTotal, 'LKR')} />
            <Stat label="Order value" value={order != null ? fmtMoney(order, 'LKR') : '—'} />
            <Stat label="Difference" value={order != null ? fmtMoney(newTotal - order, 'LKR') : '—'} tone={order != null && Math.abs(newTotal - order) > 1 ? 'amber' : 'green'} />
          </Grid>
          {order != null && Math.abs(newTotal - order) > 1 ? (
            <Notice tone={colors.amber}>The BOQ total differs from the order value – check for provisional sums, discounts or VAT before sending.</Notice>
          ) : null}
          <Row gap={8}>
            <Button title="Send to SM Projects" onPress={save} disabled={!included.length} />
            <Button title="Cancel" variant="secondary" onPress={() => setParsed(null)} />
          </Row>
          {bySection(included.flatMap((s) => s.items)).map((g) => (
            <Section key={g.section} title={g.section}>
              <DataTable
                rows={g.items}
                keyOf={(_, i) => String(i)}
                columns={[
                  { h: 'Item', w: 70, v: (i) => i.item_no ?? '' },
                  { h: 'Description', w: 380, v: (i) => <Text style={{ color: colors.ink, fontWeight: i.qty == null ? '700' : '400' }}>{i.description}</Text> },
                  { h: 'Unit', w: 60, v: (i) => i.unit ?? '' },
                  { h: 'Qty', w: 80, right: true, v: (i) => (i.qty == null ? '' : fmtNumber(i.qty, 2)) },
                  { h: 'Rate', w: 110, right: true, v: (i) => (i.rate == null ? '' : fmtNumber(i.rate, 2)) },
                  { h: 'Amount', w: 130, right: true, v: (i) => (i.amount == null ? '' : fmtNumber(i.amount, 2)) },
                ]}
              />
            </Section>
          ))}
        </Section>
      ) : null}

      {!parsed && live.length
        ? bySection(live).map((g) => (
            <Section key={g.section} title={`${g.section} · ${fmtMoney(g.items.reduce((t, i) => t + (i.heading ? 0 : Number(i.amount)), 0), 'LKR')}`}>
              <DataTable
                rows={g.items}
                keyOf={(i) => i.id}
                edge={(i) => (i.source === 'variation' ? colors.blue : undefined)}
                columns={[
                  { h: 'Item', w: 80, v: (i) => i.item_no ?? '' },
                  { h: 'Description', w: 380, v: (i) => <Text style={{ color: colors.ink, fontWeight: i.heading ? '700' : '400' }}>{i.description}</Text> },
                  { h: 'Unit', w: 60, v: (i) => i.unit ?? '' },
                  { h: 'Qty', w: 80, right: true, v: (i) => (i.qty == null ? '' : fmtNumber(Number(i.qty), 2)) },
                  { h: 'Rate', w: 110, right: true, v: (i) => (i.rate == null ? '' : fmtNumber(Number(i.rate), 2)) },
                  { h: 'Amount', w: 130, right: true, v: (i) => (i.heading ? '' : fmtNumber(Number(i.amount), 2)) },
                ]}
              />
            </Section>
          ))
        : null}
      {!parsed && items.some((i) => i.removed) ? <Muted>{`${items.filter((i) => i.removed).length} item(s) dropped by a revision are kept because they were already measured.`}</Muted> : null}
    </Screen>
  );
}
