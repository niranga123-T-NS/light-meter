import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { useMe } from '@/lib/auth';
import { colomboHHMM, colomboTime, deadlineText, isTender, submissionLabel, type DeadlineExtension, type Split } from '@/lib/deadlines';
import { pickDocument, uploadAttachment } from '@/lib/files';
import { fmtDate, fmtDateISO, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Inquiry } from '@/lib/types';
import { Button, Card, colors, Muted, Pill, Row, Section } from './ui';

const CLOSED = ['draft', 'won', 'lost', 'cancelled', 'rejected', 'quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval', 'client_approved'];

function Step({ label, date, tone, note }: { label: string; date: string; tone: string; note?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 150, borderTopWidth: 4, borderTopColor: tone, paddingTop: 6, gap: 2 }}>
      <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontWeight: '700', color: colors.ink }}>{date}</Text>
      {note ? <Muted>{note}</Muted> : null}
    </View>
  );
}

/**
 * The inquiry's deadline: client deadline (can be extended on request) or tender closing (fixed unless the client issues
 * an addendum), the design / final pricing / release split, and the extension record.
 */
export function DeadlineCard({ inquiry: i, onChange }: { inquiry: Inquiry; onChange: () => void }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const tender = isTender(i);
  const { data, reload } = useLoad(async () => {
    const [x, split] = await Promise.all([
      supabase.from('deadline_extensions').select('*').eq('inquiry_id', i.id).order('requested_at', { ascending: false }),
      i.route === 'A' ? rpc<Split | null>('deadline_split', { p_inquiry: i.id }).catch(() => null) : Promise.resolve(null),
    ]);
    return { ext: (x.data ?? []) as DeadlineExtension[], split };
  }, [i.id, i.customer_deadline, i.tender_closes_at, i.extension_status, i.design_due_at]);
  const ext = data?.ext ?? [];
  const open = ext.find((x) => x.status === 'requested');
  const isOpen = !CLOSED.includes(i.status);
  const salesSide = i.sales_person_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const canAsk = salesSide || me.role === 'design_manager' || me.role === 'sm_estimation';
  const done = async () => {
    await reload();
    onChange();
  };

  const ask = async () => {
    const r = await dialog.prompt({
      title: 'Ask the client for an extension',
      message: `Records the request. Everyone keeps working to ${fmtDate(i.customer_deadline)} until the client agrees. The sales person is told to ask the client.`,
      fields: [
        { key: 'd', label: 'Proposed new deadline', type: 'date', required: true },
        { key: 'r', label: 'Why more time is needed', type: 'multiline', required: true },
      ],
      confirmLabel: 'Record the request',
    });
    if (r) await dialog.run(async () => { await rpc('request_deadline_extension', { p_inquiry: i.id, p_proposed: r.d, p_reason: r.r }); await done(); }, 'Extension request recorded');
  };

  const granted = async () => {
    if (!open) return;
    const r = await dialog.prompt({
      title: 'Client granted the extension',
      message: "Next, choose the client's e-mail or letter (PDF or image). The design and final pricing dates move with the new deadline.",
      fields: [
        { key: 'd', label: 'New deadline agreed', type: 'date', required: true, initial: open.proposed_deadline ?? '' },
        { key: 'n', label: 'Note (optional)', type: 'multiline' },
      ],
      confirmLabel: 'Choose the e-mail',
    });
    if (!r) return;
    const file = await pickDocument();
    if (!file) return dialog.toast("Attach the client's e-mail or letter to record the extension", 'error');
    await dialog.run(async () => {
      await uploadAttachment('inquiry', i.id, 'deadline_extension', file);
      await rpc('record_extension_outcome', { p_ext: open.id, p_granted: true, p_new_deadline: r.d, p_note: r.n || null });
      await done();
    }, 'Deadline extended – dates re-split and everyone told');
  };

  const refused = async () => {
    if (!open) return;
    const r = await dialog.prompt({
      title: 'Client refused the extension',
      message: `The deadline stays ${fmtDate(i.customer_deadline)}. Design, Estimation and SM Projects are told.`,
      fields: [{ key: 'n', label: "Client's answer (optional)", type: 'multiline' }],
      confirmLabel: 'Record',
      danger: true,
    });
    if (r) await dialog.run(async () => { await rpc('record_extension_outcome', { p_ext: open.id, p_granted: false, p_note: r.n || null }); await done(); }, 'Recorded');
  };

  const tenderExtended = async () => {
    const r = await dialog.prompt({
      title: 'Tender extended by the client',
      message: 'Next, choose the addendum (PDF). The design and final pricing dates move with the new closing.',
      fields: [
        { key: 'd', label: 'New closing date', type: 'date', required: true },
        { key: 't', label: 'Closing time (HH:MM)', initial: i.tender_closes_at ? colomboHHMM(i.tender_closes_at) : '10:00', required: true },
        { key: 'a', label: 'Addendum number / reference', required: true },
        { key: 'n', label: 'Note (optional)', type: 'multiline' },
      ],
      confirmLabel: 'Choose the addendum',
    });
    if (!r) return;
    const file = await pickDocument();
    if (!file) return dialog.toast('Attach the tender addendum to record the extension', 'error');
    await dialog.run(async () => {
      await uploadAttachment('inquiry', i.id, 'tender_addendum', file);
      await rpc('record_tender_extension', { p_inquiry: i.id, p_new_closes: colomboTime(r.d, r.t), p_addendum: r.a, p_note: r.n || null });
      await done();
    }, 'Closing date moved – dates re-split and everyone told');
  };

  const split = data?.split;
  const approved = i.route === 'A' && i.design_due_status === 'approved' && i.design_due_at;
  const buttons = !isOpen
    ? []
    : tender
      ? salesSide ? [<Button key="tx" small variant="secondary" title="Tender extended by the client" onPress={tenderExtended} />] : []
      : open
        ? salesSide
          ? [
              <Button key="g" small title="Client granted" onPress={granted} />,
              <Button key="r" small variant="secondary" title="Client refused" onPress={refused} />,
            ]
          : []
        : canAsk ? [<Button key="a" small variant="secondary" title="Ask client for extension" onPress={ask} />] : [];

  return (
    <Section title="Deadline" right={buttons.length ? <Row gap={6}>{buttons}</Row> : undefined}>
      <TestingBanner what="Deadline types and extensions" />
      <Card style={{ gap: 10, borderLeftWidth: 4, borderLeftColor: tender ? colors.brand : colors.blue }}>
        <Row wrap gap={8} style={{ alignItems: 'center' }}>
          <Pill label={tender ? 'Tender – fixed closing' : 'Client deadline'} tone={tender ? colors.brand : colors.blue} solid />
          <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>{deadlineText(i)}</Text>
          {i.extension_status === 'requested' ? <Pill label="Extension requested" tone={colors.amber} /> : null}
          {i.extension_status === 'refused' ? <Pill label="Extension refused" tone={colors.red} /> : null}
          {i.extension_status === 'granted' ? <Pill label="Extended" tone={colors.green} /> : null}
        </Row>
        {tender ? <Muted>{`Ref ${i.tender_ref || '—'} · submitted by ${submissionLabel(i.tender_submission)} · the closing moves only if the client issues an addendum`}</Muted> : null}
        {open ? (
          <Muted>{`Asked to move to ${fmtDate(open.proposed_deadline)} – ${open.reason}. Everyone keeps working to ${fmtDate(i.customer_deadline)} until the client agrees.`}</Muted>
        ) : null}
        {i.route === 'A' && (approved || split) ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>{approved ? 'Split (approved)' : 'Suggested split – approved with the design date'}</Text>
            <Row wrap gap={10}>
              <Step label="Design (estimation starts too)" date={`by ${fmtDate(approved ? i.design_due_at : split?.design_due)}`} tone={colors.blue} />
              <Step
                label="Final pricing"
                date={`by ${fmtDate(approved ? (i.estimation_due_at ?? split?.estimation_due) : split?.estimation_due)}`}
                tone="#0F766E"
                note={split ? `${split.pricing_days} working day${split.pricing_days > 1 ? 's' : ''}` : undefined}
              />
              <Step label="Check & release" date={split ? `${split.release_days} working day${split.release_days > 1 ? 's' : ''}` : '—'} tone={colors.ink} />
              <Step label={tender ? 'Tender closes' : 'Client deadline'} date={tender ? fmtDateTime(i.tender_closes_at) : fmtDate(i.customer_deadline)} tone={colors.brand} />
            </Row>
            {!approved && split?.tight ? <Muted style={{ color: colors.red }}>Too tight for the standard split – the design date has to be agreed with SM Projects, or ask the client for more time.</Muted> : null}
          </View>
        ) : null}
        {ext.length ? (
          <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>Extension record</Text>
            {ext.map((x) => (
              <Row key={x.id} gap={8} style={{ alignItems: 'flex-start' }}>
                <Pill label={x.kind === 'tender_addendum' ? 'Addendum' : x.status === 'requested' ? 'Asked' : x.status === 'granted' ? 'Granted' : 'Refused'} tone={x.status === 'refused' ? colors.red : x.status === 'requested' ? colors.amber : colors.green} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink }}>
                    {x.kind === 'tender_addendum'
                      ? `${x.addendum_ref}: ${fmtDateTime(x.old_deadline)} → ${fmtDateTime(x.new_deadline)}`
                      : x.status === 'granted'
                        ? `${fmtDate(x.old_deadline ? fmtDateISO(x.old_deadline) : null)} → ${fmtDate(x.new_deadline ? fmtDateISO(x.new_deadline) : null)}`
                        : `Asked for ${fmtDate(x.proposed_deadline)}`}
                  </Text>
                  <Muted>{[x.reason, x.decision_note, `${people[x.requested_by ?? '']?.full_name ?? ''} · ${fmtDateTime(x.requested_at)}`].filter(Boolean).join(' · ')}</Muted>
                </View>
              </Row>
            ))}
          </View>
        ) : null}
      </Card>
    </Section>
  );
}
