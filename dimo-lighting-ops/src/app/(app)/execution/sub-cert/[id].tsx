import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { DocSlot } from '@/components/exec/DocSlot';
import { certTone } from '@/components/exec/CertRows';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CERT_STATUS, type SubCert } from '@/lib/execution';
import { listAttachments, openAttachment } from '@/lib/files';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';

const STEPS: { key: SubCert['status'][]; label: string; ae?: boolean }[] = [
  { key: ['ae_review', 'prepared', 'verified', 'approved', 'paid'], label: 'Submitted' },
  { key: ['prepared', 'verified', 'approved', 'paid'], label: 'AE checked', ae: true },
  { key: ['verified', 'approved', 'paid'], label: 'SEE approved' },
  { key: ['approved', 'paid'], label: 'SM Projects approved' },
  { key: ['paid'], label: 'Paid' },
];

/** One subcontractor payment certificate (IPC): the IPC and measurement sheets, the AE check, the SEE approval, then the invoice. */
export default function SubCertPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [c, f, v] = await Promise.all([
      supabase.from('sub_certs').select('*, exec_projects(code, name)').eq('id', id).single(),
      listAttachments('sub_cert', [id]),
      supabase.from('sub_invoices').select('id, code, invoice_no, status').eq('sub_cert_id', id).neq('status', 'cancelled'),
    ]);
    if (c.error) throw new Error(c.error.message);
    return {
      c: c.data as SubCert & { exec_projects: { code: string | null; name: string } | null },
      files: f as Attachment[],
      invoices: (v.data ?? []) as { id: string; code: string; invoice_no: string; status: string }[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { c, files, invoices } = data;
  const preparer = c.prepared_by === me.id || me.role === 'senior_elec_engineer';
  const editable = preparer && (c.status === 'draft' || c.status === 'returned');
  const reviewer = (c.status === 'ae_review' && me.role === 'assistant_engineer') || (c.status === 'prepared' && me.role === 'senior_elec_engineer');
  const later = (c.status === 'verified' && me.role === 'sm_projects') || (c.status === 'approved' && me.role === 'operations_exec');
  const marked = files.filter((x) => x.kind === 'ipc_markup');
  const ready = files.some((x) => x.kind === 'ipc_draft') && files.some((x) => x.kind === 'ipc_measure');
  const canRecord = (c.status === 'verified' || c.status === 'approved' || c.status === 'paid') && (c.prepared_by === me.id || me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer' || me.role === 'sub_supervisor');
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  const edit = async () => {
    const r = await dialog.prompt({
      title: 'Certificate figures',
      fields: [
        { key: 'subcontractor', label: 'Subcontractor', initial: c.subcontractor, required: true },
        { key: 'period', label: 'Period', initial: c.period, required: true },
        { key: 'gross', label: 'Gross value of work done to date (LKR)', initial: String(c.gross), required: true },
        { key: 'previous', label: 'Previously certified (LKR)', initial: String(c.previous) },
        { key: 'retention_pct', label: 'Retention %', initial: String(c.retention_pct) },
        { key: 'deductions', label: 'Other deductions (LKR)', initial: String(c.deductions) },
        { key: 'note', label: 'Note', type: 'multiline', initial: c.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await run('update_sub_cert', { p_id: c.id, p: r }, 'Saved');
  };
  const decide = async (ok: boolean) => {
    const pay = c.status === 'approved';
    const r = await dialog.prompt({
      title: pay ? 'Record the payment' : ok ? (c.status === 'ae_review' ? 'Checked – goes to the Senior Electrical Engineer' : c.status === 'prepared' ? 'Approve the IPC – the invoice can then be recorded' : 'Approve') : 'Return with comments',
      message: ok ? `${c.code} · net ${fmtMoney(c.net, 'LKR')}` : marked.length ? 'Your marked-up copy goes with it.' : 'Tip: mark your comments in red on the IPC or the sheets first (✎ Mark up), then return.',
      fields: [{ key: 'n', label: pay ? 'Payment reference (cheque / transfer)' : ok ? 'Note (optional)' : 'Reason', type: pay ? undefined : 'multiline', required: pay || !ok }],
      confirmLabel: pay ? 'Paid' : ok ? 'Approve' : 'Return',
      danger: !ok,
    });
    if (r) await run('advance_sub_cert', { p_id: c.id, p_ok: ok, p_note: r.n || null }, ok ? 'Saved' : 'Returned – the preparer is told');
  };

  return (
    <Screen maxWidth={900} onRefresh={reload}>
      <Stack.Screen options={{ title: c.code }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${c.code} · ${c.subcontractor} · ${c.period}`}</Text>
          <Pill label={CERT_STATUS[c.status]} tone={certTone(c.status)} solid={c.status === 'verified' || c.status === 'returned'} />
        </Row>
        <Muted>{`${c.exec_projects?.code ?? ''} ${c.exec_projects?.name ?? ''}`}</Muted>
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {STEPS.filter((s) => !s.ae || c.ae_by || c.status === 'ae_review').map((s) => (
            <Pill key={s.label} label={`${s.key.includes(c.status) ? '✓ ' : ''}${s.label}`} tone={s.key.includes(c.status) ? colors.green : colors.grey} />
          ))}
        </Row>
        <Row wrap gap={16} style={{ marginTop: 8 }}>
          <KeyValue label="Gross to date" value={fmtMoney(c.gross, 'LKR')} />
          <KeyValue label="Previously certified" value={fmtMoney(c.previous, 'LKR')} />
          <KeyValue label="Retention" value={`${c.retention_pct}%`} />
          <KeyValue label="Deductions" value={fmtMoney(c.deductions, 'LKR')} />
          <KeyValue label="Net" value={fmtMoney(c.net, 'LKR')} />
          <KeyValue label="Prepared by" value={`${people[c.prepared_by]?.full_name ?? '—'}${c.revision ? ` · revision ${c.revision}` : ''}`} />
        </Row>
        {c.note ? <Muted>{c.note}</Muted> : null}
        {editable ? (
          <Row style={{ marginTop: 8 }}>
            <Button small variant="secondary" title="Edit figures" onPress={edit} />
          </Row>
        ) : null}
      </Card>

      {c.status === 'draft' ? (
        <Notice tone={colors.blue}>Attach the IPC and the measurement sheets, then submit. The invoice can be recorded only after the Senior Electrical Engineer approves the IPC.</Notice>
      ) : c.status === 'ae_review' || c.status === 'prepared' ? (
        <Notice tone={colors.amber}>
          {`Waiting for approval – ${c.status === 'ae_review' ? 'with the Assistant Engineer to check, then the Senior Electrical Engineer' : 'with the Senior Electrical Engineer'}. Submitted ${fmtDateTime(c.submitted_at)}. The invoice, signed IPC and final measurement sheets can be uploaded once it is approved.`}
        </Notice>
      ) : c.status === 'returned' ? (
        <Notice tone={colors.red}>{`Returned: ${c.return_note ?? ''}\nSee the comments marked in red below, correct the IPC / sheets and submit again.`}</Notice>
      ) : c.status === 'verified' || c.status === 'approved' || c.status === 'paid' ? (
        <Notice tone={colors.green}>
          {`IPC approved by the Senior Electrical Engineer${c.verified_at ? ` on ${fmtDateTime(c.verified_at)}` : ''}. Now record the invoice with the signed IPC and the corrected (final) measurement sheets.`}
        </Notice>
      ) : null}

      <DocSlot title="IPC (payment certificate)" entity="sub_cert" entityId={c.id} kind="ipc_draft" files={files} canAdd={editable} canMarkUp={reviewer} required={editable} onChange={reload} />
      <DocSlot title="Measurement sheets" entity="sub_cert" entityId={c.id} kind="ipc_measure" files={files} canAdd={editable} canMarkUp={reviewer} required={editable} onChange={reload} />

      {marked.length ? (
        <Section title="Comments marked on the copy">
          <Card style={{ padding: 0, overflow: 'hidden', borderColor: colors.red, borderWidth: 1 }}>
            {marked.map((f) => (
              <ListRow
                key={f.id}
                highlight={colors.red}
                title={<Text style={{ color: colors.red, fontWeight: '700' }}>{f.file_name}</Text>}
                subtitle={`${people[f.uploaded_by]?.full_name ?? ''} · ${fmtDateTime(f.uploaded_at)}`}
                right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Row wrap gap={8}>
        {editable ? (
          <Button
            title={c.status === 'returned' ? 'Submit again' : 'Submit for approval'}
            disabled={!ready}
            onPress={async () => {
              if (await dialog.confirm('Submit the IPC?', 'It goes for checking and approval. You will be told here when it is approved and the invoice can be recorded.', { confirmLabel: 'Submit' }))
                await run('submit_sub_cert', { p_id: c.id }, 'Submitted for approval');
            }}
          />
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            title="Withdraw"
            onPress={async () => {
              if (await dialog.confirm('Withdraw this certificate?', undefined, { confirmLabel: 'Withdraw', danger: true })) await run('cancel_sub_cert', { p_id: c.id }, 'Withdrawn');
            }}
          />
        ) : null}
        {reviewer ? <Button title={c.status === 'ae_review' ? 'Checked – send to the SEE' : 'Approve IPC'} onPress={() => decide(true)} /> : null}
        {reviewer ? <Button variant="danger" title="Return with comments" onPress={() => decide(false)} /> : null}
        {later ? <Button title={c.status === 'approved' ? 'Record payment' : 'Approve'} onPress={() => decide(true)} /> : null}
        {later && c.status === 'verified' ? <Button variant="danger" title="Return" onPress={() => decide(false)} /> : null}
        {canRecord ? (
          <Button title="+ Record invoice" onPress={() => router.push({ pathname: '/execution/sub-invoice/new', params: { project: c.exec_project_id, cert: c.id } })} />
        ) : null}
      </Row>
      {editable && !ready ? <Muted>Attach the IPC and the measurement sheets (PDF or photos) to submit.</Muted> : null}

      {invoices.length ? (
        <Section title="Invoices against this IPC">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {invoices.map((v) => (
              <ListRow key={v.id} title={`${v.code} · invoice ${v.invoice_no}`} onPress={() => router.push(`/execution/sub-invoice/${v.id}`)} />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
