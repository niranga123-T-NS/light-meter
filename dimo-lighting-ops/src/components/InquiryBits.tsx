import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { daysBetween, fmtDate, fmtDateTime, INQUIRY_STATUS_LABEL, SLA_COLOURS, todayISO, inquiryTitle } from '@/lib/format';
import { rpc } from '@/lib/supabase';
import type { Inquiry, SlaColour } from '@/lib/types';
import { Card, colors, Muted, Pill, Progress, Row, SlaDot } from './ui';

export const STAGE_COLOUR: Record<SlaColour, string> = SLA_COLOURS;

// Stages still working towards the customer deadline (as the server's deadline alerts)
const OPEN_STAGES = ['submitted', 'accepted', 'in_design', 'design_review', 'design_approved', 'in_estimation', 'estimation_review', 'returned_for_info'];
export const deadlineCounting = (status: string) => OPEN_STAGES.includes(status);

/** The customer deadline line: a countdown while the team still works on it; once the quotation is out, when it went and
 * whether that met the deadline; closed inquiries just show the date. */
export function deadlineNote(i: Pick<Inquiry, 'status' | 'customer_deadline' | 'quotation_released_at' | 'submitted_to_client_at'>): { text: string; tone?: string; bold?: boolean } {
  if (!i.customer_deadline) return { text: 'No customer deadline' };
  const dl = fmtDate(i.customer_deadline);
  if (deadlineCounting(i.status)) {
    const left = daysBetween(todayISO(), i.customer_deadline);
    if (left < 0) return { text: `Customer deadline ${dl} – passed ${-left}d ago`, tone: colors.red, bold: true };
    return { text: `Customer deadline ${dl} (${left}d)`, tone: left <= 2 ? colors.red : undefined, bold: left <= 2 };
  }
  const sent = (i.quotation_released_at ?? i.submitted_to_client_at)?.slice(0, 10);
  if (sent) {
    const late = daysBetween(i.customer_deadline, sent);
    return late > 0
      ? { text: `Quoted ${fmtDate(sent)} – ${late}d after the deadline (${dl})`, tone: colors.amber }
      : { text: `Quoted ${fmtDate(sent)} – before the deadline (${dl})`, tone: colors.green };
  }
  return { text: `Customer deadline ${dl}` };
}

/** Progress-tracker card: stage, %, dates, colour – what Sales sees (Section 5.4). */
export function InquiryCard({ inquiry, ownerName }: { inquiry: Inquiry; ownerName?: string }) {
  const dn = deadlineNote(inquiry);
  const colour = inquiry.status === 'on_hold' ? 'grey' : inquiry.sla_colour;
  return (
    <Card onPress={() => router.push(`/inquiries/${inquiry.id}`)} style={{ borderLeftWidth: 4, borderLeftColor: STAGE_COLOUR[colour] }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <SlaDot colour={colour} />
          <Text style={{ fontWeight: '700', color: colors.ink }}>
            {inquiry.code}
            {inquiry.revision ? `-R${inquiry.revision}` : ''}
          </Text>
          <Pill label={`Route ${inquiry.route}`} />
          {inquiry.duty_status ? <Pill label={inquiry.currency} tone={colors.blue} /> : null}
          {inquiry.tender_group_id ? <Pill label="Tender · several contractors" tone={colors.amber} /> : null}
        </Row>
        <Pill label={INQUIRY_STATUS_LABEL[inquiry.status] ?? inquiry.status} tone={STAGE_COLOUR[colour]} />
      </Row>
      <Text style={{ marginTop: 6, fontWeight: '600', color: colors.text }} numberOfLines={1}>
        {inquiryTitle(inquiry)}
      </Text>
      <Muted>{inquiry.customer_name}</Muted>
      <View style={{ marginVertical: 8 }}>
        <Progress pct={inquiry.progress_pct} colour={STAGE_COLOUR[colour]} />
      </View>
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Muted>Due {fmtDateTime(inquiry.revised_due_at ?? inquiry.current_due_at)}{ownerName ? ` · ${ownerName}` : ''}</Muted>
        <Muted style={dn.tone ? { color: dn.tone, fontWeight: dn.bold ? '700' : '600' } : undefined}>{dn.text}</Muted>
      </Row>
      {inquiry.sla_colour === 'red' && inquiry.delay_reason ? (
        <Text style={{ color: colors.red, marginTop: 4 }}>
          Delay: {inquiry.delay_reason}
          {inquiry.revised_due_at ? ` · revised ${fmtDateTime(inquiry.revised_due_at)}` : ''}
        </Text>
      ) : null}
      {inquiry.status === 'on_hold' && inquiry.hold_reason ? <Muted>On hold: {inquiry.hold_reason}</Muted> : null}
    </Card>
  );
}

type TimelineRow = { at: string; from_status: string | null; to_status: string; by_name: string | null; reason: string | null };

export function InquiryTimeline({ inquiryId, refreshKey }: { inquiryId: string; refreshKey?: unknown }) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  useEffect(() => {
    rpc<TimelineRow[]>('inquiry_timeline', { p_inquiry: inquiryId }).then(setRows).catch(() => setRows([]));
  }, [inquiryId, refreshKey]);
  return (
    <Card>
      {rows.map((r, i) => (
        <Row key={i} gap={10} style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === rows.length - 1 ? colors.brand : colors.faint, marginTop: 5 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>{INQUIRY_STATUS_LABEL[r.to_status] ?? r.to_status}</Text>
            <Muted>
              {fmtDateTime(r.at)}
              {r.by_name ? ` · ${r.by_name}` : ''}
            </Muted>
            {r.reason ? <Muted>{r.reason}</Muted> : null}
          </View>
        </Row>
      ))}
      {!rows.length ? <Muted>No history yet</Muted> : null}
    </Card>
  );
}
