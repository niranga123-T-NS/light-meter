// Offline reference cache: lists the salesperson needs in the field
// (customers, contacts, projects, packages, lists, stages, colleagues and
// their own open actions / planned visits). Refreshed on sign-in, on
// reconnect and after each sync; readable with no signal.
import { kv } from './kv';
import { createStore, useStore } from './store';
import { supabase, unwrap } from './supabase';
import type { Action, Contact, Customer, LookupValue, Opportunity, Profile, Project, Stage, Territory, Visit } from './types';

export interface CacheState {
  lookups: LookupValue[];
  stages: Stage[];
  territories: Territory[];
  profiles: Profile[];
  customers: Customer[];
  contacts: Contact[];
  projects: Project[];
  opportunities: Opportunity[];
  myActions: Action[];
  plannedVisits: Visit[];
  settings: Record<string, unknown>;
  refreshedAt: string | null;
  loaded: boolean;
}

const EMPTY: CacheState = {
  lookups: [], stages: [], territories: [], profiles: [], customers: [], contacts: [], projects: [],
  opportunities: [], myActions: [], plannedVisits: [], settings: {}, refreshedAt: null, loaded: false,
};

const KEY = 'dimo:cache:v1';
export const cacheStore = createStore<CacheState>(EMPTY);

export async function loadCache(): Promise<void> {
  try {
    const raw = await kv.getItem(KEY);
    cacheStore.set(raw ? { ...EMPTY, ...JSON.parse(raw), loaded: true } : { ...EMPTY, loaded: true });
  } catch {
    cacheStore.set({ ...EMPTY, loaded: true });
  }
}

async function persist() {
  const { loaded: _loaded, ...rest } = cacheStore.get();
  await kv.setItem(KEY, JSON.stringify(rest));
}

export async function clearCache(): Promise<void> {
  cacheStore.set({ ...EMPTY, loaded: true });
  await kv.removeItem(KEY);
}

const CUSTOMER_COLS = 'id,code,legal_name,trading_name,category,industry,district,city,phone,email,owner_id,territory_id,status,strategic_priority,parent_customer_id,last_visit_at,version';
const CONTACT_COLS = 'id,code,customer_id,full_name,designation,department,work_phone,mobile_phone,email,decision_role,active,version';
const PROJECT_COLS = 'id,code,name,aliases,district,city,customer_id,developer_id,end_user_id,segments,owner_id,territory_id,status,tender_closing_date,quotation_due_date,last_activity_at,currency,version';
const OPP_COLS = 'id,code,project_id,name,segment,owner_id,stage_id,probability,estimated_value,currency,weighted_value,expected_order_date,quotation_due_date,closed_at,version';

/** Download the reference lists. Throws when offline (callers keep the old cache). */
export async function refreshCache(userId: string): Promise<void> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [lookups, stages, territories, profiles, pts, customers, contacts, projects, opps, actions, visits, settings] = await Promise.all([
    supabase.from('lookup_values').select('id,list_key,code,label,sort_order,active').order('list_key').order('sort_order'),
    supabase.from('pipeline_stages').select('*').order('sort_order'),
    supabase.from('territories').select('id,code,name,active').order('name'),
    supabase.from('profiles').select('id,email,full_name,role,active').order('full_name'),
    supabase.from('profile_territories').select('user_id,territory_id'),
    supabase.from('customers').select(CUSTOMER_COLS).is('deleted_at', null).order('legal_name').limit(5000),
    supabase.from('contacts').select(CONTACT_COLS).is('deleted_at', null).eq('active', true).order('full_name').limit(10000),
    supabase.from('projects').select(PROJECT_COLS).is('deleted_at', null).order('last_activity_at', { ascending: false }).limit(3000),
    supabase.from('opportunities').select(OPP_COLS).is('deleted_at', null).limit(5000),
    supabase.from('actions').select('*').or(`owner_id.eq.${userId},created_by.eq.${userId}`).in('status', ['open', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from('visits').select('*').eq('salesperson_id', userId).or(`status.eq.planned,and(status.eq.submitted,visit_date.gte.${since.slice(0, 10)})`)
      .order('scheduled_at', { ascending: true }).limit(500),
    supabase.from('app_settings').select('key,value'),
  ]);
  const territoryMap = new Map<string, string[]>();
  for (const pt of unwrap(pts) as { user_id: string; territory_id: string }[]) {
    territoryMap.set(pt.user_id, [...(territoryMap.get(pt.user_id) ?? []), pt.territory_id]);
  }
  cacheStore.set({
    lookups: unwrap(lookups) as LookupValue[],
    stages: unwrap(stages) as Stage[],
    territories: unwrap(territories) as Territory[],
    profiles: (unwrap(profiles) as Profile[]).map((p) => ({ ...p, territory_ids: territoryMap.get(p.id) ?? [] })),
    customers: unwrap(customers) as Customer[],
    contacts: unwrap(contacts) as Contact[],
    projects: unwrap(projects) as Project[],
    opportunities: unwrap(opps) as Opportunity[],
    myActions: unwrap(actions) as Action[],
    plannedVisits: unwrap(visits) as Visit[],
    settings: Object.fromEntries((unwrap(settings) as { key: string; value: unknown }[]).map((s) => [s.key, s.value])),
    refreshedAt: new Date().toISOString(),
    loaded: true,
  });
  await persist();
}

type ListKey = 'customers' | 'contacts' | 'projects' | 'opportunities' | 'myActions' | 'plannedVisits';

/** Put a record created or edited online into the cache immediately. */
export function upsertCached<K extends ListKey>(key: K, row: CacheState[K][number]): void {
  cacheStore.set((s) => {
    const list = s[key] as { id: string }[];
    const idx = list.findIndex((r) => r.id === (row as { id: string }).id);
    const next = idx >= 0 ? list.map((r, i) => (i === idx ? { ...r, ...row } : r)) : [row, ...list];
    return { ...s, [key]: next };
  });
  void persist();
}

export function removeCached(key: ListKey, id: string): void {
  cacheStore.set((s) => ({ ...s, [key]: (s[key] as { id: string }[]).filter((r) => r.id !== id) }));
  void persist();
}

// ---------------------------------------------------------------------------
// Hooks and lookups
// ---------------------------------------------------------------------------
export function useCache<K extends keyof CacheState>(key: K): CacheState[K] {
  return useStore(cacheStore, (s) => s[key]);
}

export interface Option { value: string; label: string }

export function lookupOptions(lookups: LookupValue[], listKey: string, includeCode?: string | null): Option[] {
  return lookups
    .filter((l) => l.list_key === listKey && (l.active || l.code === includeCode))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({ value: l.code, label: l.label }));
}

export function useLookup(listKey: string): Option[] {
  const lookups = useCache('lookups');
  return lookupOptions(lookups, listKey);
}

export function lookupLabel(listKey: string, code?: string | null): string {
  if (!code) return '–';
  return cacheStore.get().lookups.find((l) => l.list_key === listKey && l.code === code)?.label ?? code;
}

export function profileName(id?: string | null): string {
  if (!id) return '–';
  return cacheStore.get().profiles.find((p) => p.id === id)?.full_name ?? 'Unknown user';
}

export function customerName(id?: string | null): string {
  if (!id) return '–';
  const c = cacheStore.get().customers.find((x) => x.id === id);
  return c ? c.trading_name || c.legal_name : '–';
}

export function stageById(id?: string | null): Stage | undefined {
  return cacheStore.get().stages.find((s) => s.id === id);
}

export function setting<T>(key: string, fallback: T): T {
  const v = cacheStore.get().settings[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

/** Normalised name used for local duplicate hints (mirrors public.normalize_name). */
export function normalizeName(t?: string | null): string {
  return (t ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(^| )(pvt|private|ltd|limited|plc|inc|llc|co|company|the|holdings|pte)(?= |$)/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}
