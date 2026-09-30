import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { daysBetween, fmtDate, fmtDateTime, INQUIRY_STATUS_LABEL, SLA_COLOURS, todayISO } from '@/lib/format';
import { rpc } from '@/lib/supabase';
import type { Inquiry, SlaColour } from '@/lib/types';
import { Card, colors, Muted, Pill, Progress, Row, SlaDot } from './ui';

export const STAGE_COLOUR: Record<SlaColour, string> = SLA_COLOURS;

/** Progress-tracker card: stage, %, dates, colour – what Sales sees (Section 5.4). */
export function InquiryCard({ inquiry, ownerName }: { inquiry: Inquiry; ownerName?: string }) {
  const daysLeft = inquiry.customer_deadline ? daysBetween(todayISO(), inquiry.customer_deadline) : null;
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
        </Row>
        <Pill label={INQUIRY_STATUS_LABEL[inquiry.status] ?? inquiry.status} tone={STAGE_COLOUR[colour]} />
      </Row>
      <Text style={{ marginTop: 6, fontWeight: '600', color: colors.text }} numberOfLines={1}>
        {inquiry.project_name}
      </Text>
      <Muted>{inquiry.customer_name}</Muted>
      <View style={{ marginVertical: 8 }}>
        <Progress pct={inquiry.progress_pct} colour={STAGE_COLOUR[colour]} />
      </View>
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Muted>Due {fmtDateTime(inquiry.revised_due_at ?? inquiry.current_due_at)}{ownerName ? ` · ${ownerName}` : ''}</Muted>
        <Muted style={daysLeft != null && daysLeft <= 2 ? { color: colors.red, fontWeight: '700' } : undefined}>
          Customer deadline {fmtDate(inquiry.customer_deadline)}
          {daysLeft != null ? ` (${daysLeft}d)` : ''}
        </Muted>
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
