import { supabase, unwrap } from './supabase';

const READ_ONLY = ['code', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'normalized_name',
  'weighted_value', 'duration_minutes', 'last_activity_at', 'last_visit_at', 'closed_at', 'completed_at', 'submitted_at'];

/**
 * Insert or update a row. Updates use optimistic concurrency: the row's
 * version must still match, so two people editing at once cannot silently
 * overwrite each other.
 */
export async function saveRecord<T extends { id: string; version?: number }>(
  table: string, row: T, isNew: boolean, extraReadOnly: string[] = [],
): Promise<T> {
  const clean = Object.fromEntries(Object.entries(row).filter(([k]) => !READ_ONLY.includes(k) && !extraReadOnly.includes(k)));
  if (isNew) return unwrap(await supabase.from(table).insert(clean).select().single()) as T;
  let q = supabase.from(table).update(clean).eq('id', row.id);
  if (row.version != null) q = q.eq('version', row.version);
  const res = await q.select();
  if (res.error) throw res.error;
  if (!res.data?.length) {
    throw new Error('Not saved: someone else changed this record since you opened it, or you do not have permission. Reload and try again.');
  }
  return res.data[0] as T;
}

export async function fetchOne<T>(table: string, id: string): Promise<T | null> {
  return unwrap(await supabase.from(table).select('*').eq('id', id).maybeSingle()) as T | null;
}
