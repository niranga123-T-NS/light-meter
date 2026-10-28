import { carve, type Hist, type Seg } from '@/lib/processNodes';
import { supabase } from '@/lib/supabase';

export type Clar = { inquiry_id: string; estimation_job_id: string | null; design_job_id: string | null; question: string; asked_at: string; answered_at: string | null };

/** Status history of one kind of item, grouped by item */
export async function historyOf(kind: 'inquiry' | 'estimation_job' | 'design_job') {
  const out = new Map<string, Hist[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('status_history').select('entity_id, from_status, to_status, at').eq('entity_type', kind).order('at').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const h of (data ?? []) as Hist[]) out.set(h.entity_id, [...(out.get(h.entity_id) ?? []), h]);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function holidaysSet() {
  const { data } = await supabase.from('holidays').select('day');
  return new Set(((data ?? []) as { day: string }[]).map((x) => x.day));
}

export async function clarifications() {
  const { data, error } = await supabase.from('clarifications').select('inquiry_id, estimation_job_id, design_job_id, question, asked_at, answered_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Clar[];
}

const short = (t: string) => (t.length > 60 ? t.slice(0, 57) + '…' : t);

/**
 * A clarification moves the waiting time out of the work nodes into the hidden node. Answered but not recorded:
 * the item moved on from the work node after the question – it ends there, marked "end not seen".
 */
export function withClarifications(segs: Seg[], cs: Clar[], work: string[], node: string, prefix: string, holidays: Set<string>, now: string) {
  let out = segs;
  for (const c of [...cs].sort((a, b) => (a.asked_at < b.asked_at ? -1 : 1))) {
    let end = c.answered_at;
    let est: 'end' | undefined;
    if (!end) {
      const moved = out.find((s) => s.start > c.asked_at && !work.includes(s.node) && s.node !== node);
      if (moved) { end = moved.start; est = 'end'; }
    }
    out = carve(out, { start: c.asked_at, end, node, label: `${prefix}: ${short(c.question)}`, est }, work, holidays, now);
  }
  return out;
}
