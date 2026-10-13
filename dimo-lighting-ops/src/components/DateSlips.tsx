import { DataTable } from '@/components/DataTable';
import { Muted, Section } from '@/components/ui';
import { reasonLabel, workdays, type DateChange } from '@/lib/foreignOrders';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Row = { key: string; party: string; reason: string; changes: number; later: number; days: number };

/** Expected-date changes by who caused them: how often and by how many working days (manufacturers, suppliers, shipping lines, airlines …) */
export function DateSlips({ module, from, holidays }: { module: 'fo' | 'lo'; from: string; holidays: Set<string> }) {
  const { data } = useLoad(async () => ((await supabase.from('order_date_changes').select('*').eq('module', module)).data ?? []) as DateChange[], [module]);
  const groups = new Map<string, Row>();
  for (const c of (data ?? []).filter((x) => x.reason !== 'first' && x.old_date && x.changed_at.slice(0, 10) >= from)) {
    const party = c.party ?? 'Not stated';
    const key = `${party}|${c.reason}`;
    const g = groups.get(key) ?? { key, party, reason: reasonLabel(c.reason), changes: 0, later: 0, days: 0 };
    g.changes += 1;
    if (c.new_date > c.old_date!) {
      g.later += 1;
      g.days += workdays(c.old_date, c.new_date, holidays) ?? 0;
    }
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.days - a.days);
  return (
    <Section title="Date changes by who caused them">
      <Muted>Every change of an expected date (and, for foreign orders, of a shipment ETA) with its reason. Slip = working days later than the date before.</Muted>
      <DataTable
        rows={rows}
        keyOf={(r) => r.key}
        emptyTitle="No date changes in this period"
        columns={[
          { h: 'Who', w: 220, grow: true, v: (r) => r.party },
          { h: 'Reason', w: 200, v: (r) => r.reason },
          { h: 'Changes', w: 90, right: true, v: (r) => String(r.changes) },
          { h: 'Later', w: 70, right: true, v: (r) => String(r.later) },
          { h: 'Slip (working days)', w: 150, right: true, bold: true, v: (r) => String(r.days) },
          { h: 'Average slip', w: 110, right: true, v: (r) => (r.later ? (r.days / r.later).toFixed(1) : '—') },
        ]}
      />
    </Section>
  );
}
