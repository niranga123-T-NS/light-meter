import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Muted, Notice, Pill, Row, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CERT_STATUS, SINV_NOTICE, SINV_STATUS, type ExecProject, type SubCert, type SubInvoice } from '@/lib/execution';
import { listAttachments, openAttachment } from '@/lib/files';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';
import { certForMe, certTone } from './CertRows';

type Tab = 'measure' | 'ipa' | 'ipc';
type Var = { id: string; sub_cert_id?: string; invoice_id?: string; var_code: string };

// How far a certificate has come: < 4 joint measurement · 4–6 IPA · ≥ 7 IPA approved (IPC stage)
const RANK: Record<SubCert['status'], number> = {
  jm_requested: 0, jm_scheduled: 1, jm_returned: 1, jm_ae: 2, jm_see: 3, draft: 4, returned: 4, ae_review: 5, prepared: 6, verified: 7, approved: 8, paid: 9, cancelled: -1,
};
const TONE = { grey: colors.grey, amber: colors.amber, blue: colors.blue, green: colors.green, red: colors.red };

function jmLabel(c: SubCert) {
  if (RANK[c.status] >= 4) return c.jm_see_at ? `Approved ${fmtDate(c.jm_see_at)}` : c.jm_requested_date ? 'Approved' : 'Before joint measurements were recorded';
  if (c.status === 'jm_requested') return `Requested · proposed ${fmtDate(c.jm_requested_date)}`;
  if (c.status === 'jm_scheduled') return `Confirmed for ${fmtDate(c.jm_date)} – upload the sheets`;
  return CERT_STATUS[c.status];
}
function ipaLabel(c: SubCert) {
  if (RANK[c.status] >= 7) return c.verified_at ? `IPA approved ${fmtDate(c.verified_at)}` : 'IPA approved';
  return CERT_STATUS[c.status];
}

/** Files of one stage as tap-to-open links */
function FileLinks({ files, label }: { files: Attachment[]; label: string }) {
  const dialog = useDialog();
  return (
    <Row wrap gap={6} style={{ marginTop: 6, alignItems: 'center' }}>
      <Muted>{`${label}:`}</Muted>
      {files.length ? (
        files.map((f) => <Button key={f.id} small variant="secondary" title={`⬇ ${f.file_name}`} onPress={() => dialog.run(() => openAttachment(f))} />)
      ) : (
        <Muted>—</Muted>
      )}
    </Row>
  );
}

/** Subcontractor IPC & invoices in three sub-tabs – Measurements, IPA, IPC – each with its downloadable format, its uploads and every record, also after approval. */
export function SubCertsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>('measure');
  const { data, reload } = useLoad(async () => {
    const [{ data: c }, { data: v }, varOpts] = await Promise.all([
      supabase.from('sub_certs').select('*').eq('exec_project_id', p.id).neq('status', 'cancelled').order('prepared_at', { ascending: false }),
      supabase.from('sub_invoices').select('*').eq('exec_project_id', p.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
      rpc<{ id: string; code: string; vo_no: string | null; title: string }[]>('sub_variation_options', { p_exec: p.id }).catch(() => []),
    ]);
    const certs = (c ?? []) as SubCert[];
    const invoices = (v ?? []) as SubInvoice[];
    const [cv, iv] = await Promise.all([
      certs.length ? supabase.from('sub_cert_variations').select('id, sub_cert_id, var_code').in('sub_cert_id', certs.map((x) => x.id)) : Promise.resolve({ data: [] }),
      invoices.length ? supabase.from('sub_invoice_variations').select('id, invoice_id, var_code').in('invoice_id', invoices.map((x) => x.id)) : Promise.resolve({ data: [] }),
    ]);
    const certVars = (cv.data ?? []) as Var[];
    const invVars = (iv.data ?? []) as Var[];
    const [tf, cf, vf, inf, ivf] = await Promise.all([
      listAttachments('exec_project', [p.id]),
      listAttachments('sub_cert', certs.map((x) => x.id)),
      listAttachments('sub_cert_var', certVars.map((x) => x.id)),
      listAttachments('sub_invoice', invoices.map((x) => x.id)),
      listAttachments('sub_invoice_var', invVars.map((x) => x.id)),
    ]);
    return { varOpts, certs, invoices, certVars, invVars, formats: tf as Attachment[], files: [...cf, ...vf, ...inf, ...ivf] as Attachment[] };
  }, [p.id]);
  const sub = me.role === 'sub_supervisor';
  const canRecord = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer' || sub;
  const active = p.status === 'active';
  const certs = data?.certs ?? [];
  const files = data?.files ?? [];
  const of = (id: string, ...kinds: string[]) => files.filter((f) => f.entity_id === id && kinds.includes(f.kind));
  const varFiles = (vars: Var[], key: 'sub_cert_id' | 'invoice_id', id: string, kind: string) => {
    const ids = vars.filter((x) => x[key] === id).map((x) => x.id);
    return files.filter((f) => ids.includes(f.entity_id) && f.kind === kind);
  };

  // Grouped by measurement cycle (subcontractor + period): the BOQ work first, then each variation – each submitted separately
  const cycle = (c: SubCert) => `${c.subcontractor} · ${c.period}`;
  const ordered = [...certs].sort((a, b) => {
    const ka = cycle(a), kb = cycle(b);
    if (ka !== kb) return (certs.findIndex((x) => cycle(x) === ka) - certs.findIndex((x) => cycle(x) === kb));
    return (a.var_code ? 1 : 0) - (b.var_code ? 1 : 0) || (a.var_code ?? '').localeCompare(b.var_code ?? '');
  });
  const measure = ordered;
  const ipa = ordered.filter((c) => RANK[c.status] >= 4);
  const ipc = ordered.filter((c) => RANK[c.status] >= 7);
  const groupHead = (list: SubCert[], i: number) =>
    i === 0 || cycle(list[i - 1]) !== cycle(list[i]) ? (
      <Text key={`h-${list[i].id}`} style={{ fontWeight: '700', color: colors.muted, marginTop: i ? 14 : 4, marginBottom: 2 }}>{`Cycle: ${cycle(list[i])}`}</Text>
    ) : null;
  const mine = (c: SubCert) => certForMe(c, me);
  const invMine = (v: SubInvoice) =>
    (v.created_by === me.id && (v.status === 'draft' || v.status === 'returned')) ||
    (me.role === 'assistant_engineer' && v.status === 'ae_review') ||
    (me.role === 'senior_elec_engineer' && v.status === 'submitted') ||
    (me.role === 'operations_exec' && (v.status === 'see_approved' || v.status === 'approved'));
  const badge = {
    measure: measure.filter((c) => RANK[c.status] < 4 && mine(c)).length,
    ipa: ipa.filter((c) => RANK[c.status] < 7 && mine(c)).length,
    ipc: (data?.invoices ?? []).filter(invMine).length + ipc.filter(mine).length,
  };

  const request = async () => {
    const res = await dialog.prompt({
      title: 'Request a joint measurement',
      message: 'The first step of every IPC. The AE / SEE confirms the date; after the measurement upload the joint measurement sheets for approval – then the IPA.',
      fields: [
        { key: 'subcontractor', label: 'Subcontractor', required: true },
        { key: 'period', label: 'Period (e.g. Oct 2026)', required: true },
        { key: 'jm_date', label: 'Proposed date for the joint measurement', type: 'date', required: true },
        {
          key: 'what',
          label: 'What to measure in this cycle',
          type: 'select',
          required: true,
          initial: 'boq',
          options: [
            { value: 'boq', label: 'BOQ (contract) work only' },
            { value: 'both', label: 'BOQ work + variations (each submitted separately)' },
            { value: 'vars', label: 'Variations only' },
          ],
        },
        {
          key: 'vars',
          label: 'Variations in this cycle',
          type: 'multiselect',
          options: (data?.varOpts ?? []).map((v) => ({ value: v.id, label: `${v.vo_no || v.code} · ${v.title}` })),
          hint: (data?.varOpts ?? []).length
            ? 'Tick the variations – each gets its own measurement, IPA and IPC'
            : 'No approved variations on this project yet – a variation can be measured once it is approved (Variations tab)',
        },
        { key: 'jm_scope', label: 'Work / areas to measure', type: 'multiline' },
      ],
      confirmLabel: 'Request',
    });
    if (!res) return;
    const { vars, what, ...rest } = res as Record<string, string>;
    const boq = what !== 'vars';
    const variation_ids = what === 'boq' ? [] : (vars ?? '').split(',').filter(Boolean);
    if (what !== 'boq' && !variation_ids.length)
      return dialog.toast((data?.varOpts ?? []).length ? 'Tick the variations to measure' : 'No approved variations on this project yet', 'error');
    await dialog.run(async () => {
      const ids = await rpc<string[]>('request_joint_measurements', { p_exec: p.id, p: { ...rest, boq, variation_ids } });
      if (ids.length === 1) router.push(`/execution/sub-cert/${ids[0]}`);
      else await reload();
    }, variation_ids.length + (boq ? 1 : 0) > 1 ? `Requested – ${variation_ids.length + (boq ? 1 : 0)} separate measurements (BOQ / each variation)` : undefined);
  };

  const head = (c: SubCert, label: string, tone: string, action?: string) => (
    <>
      <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <Row gap={6} wrap style={{ alignItems: 'center', flexShrink: 1 }}>
          <Pill label={c.var_code ? `Variation ${c.var_code}` : 'BOQ work'} tone={c.var_code ? colors.blue : colors.grey} solid={!!c.var_code} />
          <Text style={{ fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{`${c.code}${c.var_title ? ` · ${c.var_title}` : ''}`}</Text>
        </Row>
        <Row gap={6} wrap>
          <Pill label={label} tone={tone} />
          <Button small variant={mine(c) ? undefined : 'secondary'} title={action && mine(c) ? action : 'Open'} onPress={() => router.push(`/execution/sub-cert/${c.id}`)} />
        </Row>
      </Row>
    </>
  );
  const formats = (kind: string, what: string) => {
    const f = (data?.formats ?? []).filter((x) => x.kind === kind);
    return (
      <Card>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`${what} format`}</Text>
        {f.length ? <FileLinks label="Download" files={f} /> : <Muted>Not uploaded yet – the SEE uploads the formats on the project overview.</Muted>}
      </Card>
    );
  };

  return (
    <>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'measure', label: 'Measurements', badge: badge.measure },
          { value: 'ipa', label: 'IPA', badge: badge.ipa },
          { value: 'ipc', label: 'IPC', badge: badge.ipc },
        ]}
      />

      {tab === 'measure' ? (
        <>
          {formats('tpl_measurement', 'Joint measurement')}
          <Section title="Joint measurements" right={canRecord && active ? <Button small title="+ Request joint measurement" onPress={request} /> : null}>
            {measure.length ? (
              measure.map((c, i) => [groupHead(measure, i), (
                <Card key={c.id} style={mine(c) && RANK[c.status] < 4 ? { borderColor: colors.amber, borderWidth: 1 } : undefined}>
                  {head(c, jmLabel(c), RANK[c.status] >= 4 ? colors.green : certTone(c.status), c.status === 'jm_requested' ? 'Confirm' : c.status === 'jm_ae' || c.status === 'jm_see' ? 'Review' : 'Upload sheets')}
                  <Muted>
                    {[c.jm_scope, c.jm_date ? `${RANK[c.status] >= 2 ? "measured" : "joint measurement on"} ${fmtDate(c.jm_date)}${c.jm_note ? ` (${c.jm_note})` : ''}` : null, c.status === 'jm_returned' && c.return_note ? `returned: ${c.return_note}` : null]
                      .filter(Boolean)
                      .join(' · ') || ' '}
                  </Muted>
                  <FileLinks label="Joint measurement sheets" files={of(c.id, 'jm_sheet')} />
                </Card>
              )])
            ) : (
              <Empty title={sub ? 'No joint measurement requested by you yet' : 'No joint measurements yet'} />
            )}
            <Muted>Request the joint measurement first; after it is done upload the sheets – checked by the AE (for a supervisor), approved by the SEE. The IPA opens once they are approved.</Muted>
          </Section>
        </>
      ) : null}

      {tab === 'ipa' ? (
        <>
          {formats('tpl_ipa', 'IPA')}
          <Section title="Interim Payment Approval (IPA)">
            {ipa.length ? (
              ipa.map((c, i) => [groupHead(ipa, i), (
                <Card key={c.id} style={mine(c) && RANK[c.status] < 7 ? { borderColor: colors.amber, borderWidth: 1 } : undefined}>
                  {head(c, ipaLabel(c), RANK[c.status] >= 7 ? colors.green : certTone(c.status), c.status === 'draft' || c.status === 'returned' ? 'Upload & submit' : 'Review')}
                  <Muted>
                    {[
                      c.gross > 0 ? `gross ${fmtMoney(c.gross, 'LKR')} − previous ${fmtMoney(c.previous, 'LKR')} − retention ${c.retention_pct}% − deductions ${fmtMoney(c.deductions, 'LKR')} = net ${fmtMoney(c.net, 'LKR')}` : 'Figures not entered yet',
                      c.submitted_at ? `submitted ${fmtDate(c.submitted_at)}` : null,
                      c.status === 'returned' && c.return_note ? `returned: ${c.return_note}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                  <FileLinks label="IPC" files={of(c.id, 'ipc_draft')} />
                  <FileLinks label="Measurement sheets" files={of(c.id, 'ipc_measure')} />
                  {(data?.certVars ?? []).some((x) => x.sub_cert_id === c.id) ? (
                    <FileLinks
                      label={`Variations (${(data?.certVars ?? []).filter((x) => x.sub_cert_id === c.id).map((x) => x.var_code).join(', ')})`}
                      files={varFiles(data?.certVars ?? [], 'sub_cert_id', c.id, 'ipc_var')}
                    />
                  ) : null}
                </Card>
              )])
            ) : (
              <Empty title="Nothing yet – the IPA opens once a joint measurement is approved" />
            )}
            {ipa.some((c) => RANK[c.status] >= 7) ? (
              <Muted>{`IPA approved to date: ${fmtMoney(ipa.filter((c) => RANK[c.status] >= 7).reduce((a, c) => a + Number(c.net), 0), 'LKR')} net`}</Muted>
            ) : null}
            <Muted>Enter the figures, upload the IPC, measurement sheets and each ticked variation – the AE checks (for a supervisor), the SEE gives IPA. Until then it shows “IPA pending”.</Muted>
          </Section>
        </>
      ) : null}

      {tab === 'ipc' ? (
        <>
          {formats('tpl_ipc', 'IPC')}
          {canRecord ? <Notice tone={colors.blue}>{SINV_NOTICE}</Notice> : null}
          <Section title="IPC & invoices">
            {ipc.length ? (
              ipc.map((c, i) => {
                const invs = (data?.invoices ?? []).filter((v) => v.sub_cert_id === c.id);
                return [groupHead(ipc, i), (
                  <Card key={c.id}>
                    {head(c, `${ipaLabel(c)} · ${CERT_STATUS[c.status].replace(/^IPA approved – /, '')}`, c.status === 'paid' ? colors.green : colors.blue)}
                    <Muted>{`Net ${fmtMoney(c.net, 'LKR')}${c.paid_ref ? ` · paid ${fmtDate(c.paid_at)} · ${c.paid_ref}` : ''}`}</Muted>
                    {invs.map((v) => {
                      const st = SINV_STATUS[v.status];
                      return (
                        <Card key={v.id} style={{ marginTop: 8, backgroundColor: colors.bg }}>
                          <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <Text style={{ fontWeight: '600', color: colors.ink }}>{`${v.code} · invoice ${v.invoice_no} · ${fmtDate(v.invoice_date)} · ${fmtMoney(v.amount, 'LKR')}`}</Text>
                            <Row gap={6} wrap>
                              <Pill label={st.label} tone={TONE[st.tone]} />
                              <Button small variant={invMine(v) ? undefined : 'secondary'} title={invMine(v) ? (v.status === 'draft' || v.status === 'returned' ? 'Upload & submit' : 'Review') : 'Open'} onPress={() => router.push(`/execution/sub-invoice/${v.id}`)} />
                            </Row>
                          </Row>
                          <FileLinks label="IPC – IPA approved, signed" files={of(v.id, 'ipc_signed')} />
                          <FileLinks label="Final measurement sheets" files={of(v.id, 'measure_final')} />
                          <FileLinks label="Invoice" files={of(v.id, 'sinv_doc')} />
                          {(data?.invVars ?? []).some((x) => x.invoice_id === v.id) ? (
                            <FileLinks label="Variations – signed" files={varFiles(data?.invVars ?? [], 'invoice_id', v.id, 'var_final')} />
                          ) : null}
                        </Card>
                      );
                    })}
                    {!invs.length ? <Muted>No invoice recorded yet.</Muted> : null}
                    {canRecord && active ? (
                      <Row style={{ marginTop: 8 }}>
                        <Button small title="+ Record invoice" onPress={() => router.push({ pathname: '/execution/sub-invoice/new', params: { project: p.id, cert: c.id } })} />
                      </Row>
                    ) : null}
                  </Card>
                )];
              })
            ) : (
              <Empty title="Nothing yet – the IPC opens once IPA is approved" />
            )}
            <Muted>After IPA: upload the IPA-approved IPC with signatures, the corrected (final) measurement sheets, each variation and the invoice · approved by the SEE, then Operations · then the physical documents go to the office.</Muted>
          </Section>
        </>
      ) : null}
    </>
  );
}
