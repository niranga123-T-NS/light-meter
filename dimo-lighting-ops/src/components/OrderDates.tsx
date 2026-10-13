import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { Button, Card, colors, Muted, Row } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { DATE_REASONS, reasonLabel, todayIso, workdays, type DateChange } from '@/lib/foreignOrders';
import type { Profile } from '@/lib/types';

/**
 * An order's expected date with its committed (first) date, how far it has slipped, and every change with its reason.
 * Foreign: the ready date at the factory and the expected date at site; local: the delivery / completion date.
 */
export function OrderDates({
  module,
  orderId,
  label,
  expected,
  committed,
  required,
  site,
  siteNote,
  changes,
  keeper,
  holidays,
  people,
  onChange,
}: {
  module: 'fo' | 'lo';
  orderId: string;
  label: string;
  expected: string | null | undefined;
  committed: string | null | undefined;
  required: string | null;
  /** foreign: expected at site (worked out) */
  site?: string | null;
  siteNote?: string;
  changes: DateChange[];
  keeper: boolean;
  holidays: Set<string>;
  people: Record<string, Profile>;
  onChange: () => void;
}) {
  const dialog = useDialog();
  const slip = expected && committed && expected > committed ? workdays(committed, expected, holidays) : 0;
  const arrive = site ?? expected ?? null;
  const late = !!(arrive && required && arrive > required);

  const set = async () => {
    const first = !expected;
    const r = await dialog.prompt({
      title: first ? `Set: ${label}` : `Change: ${label}`,
      message: first
        ? 'The first date is kept as the committed date.'
        : `Now ${fmtDate(expected)}, committed ${fmtDate(committed)}. The sales person, the SEE and the requester are told; SM Projects and the DGM too if the order now arrives after ${required ? fmtDate(required) : 'its required date'}.`,
      fields: [
        { key: 'date', label: 'New date', type: 'date', required: true, initial: expected ?? todayIso() },
        ...(first
          ? []
          : [
              { key: 'reason', label: 'Reason', type: 'select' as const, required: true, options: DATE_REASONS },
              { key: 'party', label: 'Who caused it', hint: 'e.g. the manufacturer, the bank, the shipping line' },
            ]),
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: first ? 'Set' : 'Change',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc(`${module}_set_expected`, { p_order: orderId, p_date: r.date, p_reason: r.reason ?? null, p_party: r.party ?? null, p_note: r.note || null });
      onChange();
    }, first ? 'Set' : 'Changed – the people concerned are told');
  };

  const mine = changes.filter((c) => c.kind !== 'eta' || module === 'fo').sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  return (
    <Card style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: late ? colors.red : slip ? colors.amber : colors.line }}>
      <Row wrap gap={8} style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Muted>{label}</Muted>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
            {expected ? fmtDate(expected) : 'Not set yet'}
            {slip ? <Text style={{ color: colors.amber, fontWeight: '600', fontSize: 14 }}>{`  +${slip} working day${slip === 1 ? '' : 's'}`}</Text> : null}
          </Text>
          {committed && expected !== committed ? <Muted>{`Committed ${fmtDate(committed)}`}</Muted> : null}
        </View>
        {site !== undefined ? (
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Muted>Expected at site</Muted>
            <Text style={{ fontSize: 16, fontWeight: '700', color: late ? colors.red : colors.ink }}>{site ? `about ${fmtDate(site)}` : '—'}</Text>
            {siteNote ? <Muted>{siteNote}</Muted> : null}
          </View>
        ) : null}
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Muted>Required by</Muted>
          <Text style={{ fontSize: 16, fontWeight: '700', color: late ? colors.red : colors.ink }}>{required ? fmtDate(required) : '—'}</Text>
          {late ? <Text style={{ color: colors.red, fontSize: 12, fontWeight: '700' }}>{`${workdays(required, arrive, holidays)} working days late`}</Text> : null}
        </View>
        {keeper ? <Button small variant={expected ? 'secondary' : 'primary'} title={expected ? 'Change date' : 'Set date'} onPress={set} /> : null}
      </Row>
      {mine.length > 1 || mine.some((c) => c.reason !== 'first') ? (
        <View style={{ gap: 3, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
          {mine.map((c) => (
            <Muted key={c.id}>
              {[
                fmtDateTime(c.changed_at),
                c.kind === 'eta' ? 'ETA' : c.kind === 'ready' ? 'Ready date' : 'Date',
                c.old_date ? `${fmtDate(c.old_date)} → ${fmtDate(c.new_date)}` : fmtDate(c.new_date),
                reasonLabel(c.reason),
                c.party,
                c.note,
                c.changed_by ? people[c.changed_by]?.full_name : 'flight / vessel check',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
