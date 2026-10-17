import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { rpc, supabase } from './supabase';
import type { Role } from './types';

/** Design Tools: GM / DGM, SM Projects and the design team only (a high level user from outside does not get them) */
export const DESIGN_TOOLS_ROLES: Role[] = ['gm', 'sm_projects', 'design_manager', 'lighting_designer', 'lighting_engineer'];
export const canUseDesignTools = (role?: Role | null) => !!role && DESIGN_TOOLS_ROLES.includes(role);

export type DtStatus = 'draft' | 'for_check' | 'checked' | 'approved';
export const DT_STATUS: Record<DtStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '#6B7280' },
  for_check: { label: 'For check', tone: '#B45309' },
  checked: { label: 'Checked', tone: '#1D4ED8' },
  approved: { label: 'Approved', tone: '#15803D' },
};
export const DT_TEMPLATES = [
  { value: 'blank', label: 'Blank – transformer (LV side) and an empty MDB' },
  { value: 'building', label: 'Example – building, office / hotel' },
  { value: 'road', label: 'Example – road lighting, feeder pillar' },
  { value: 'sports', label: 'Example – sports ground, high masts' },
  { value: 'apron', label: 'Example – airport apron, high masts' },
];
export const dtTemplateLabel = (t?: string | null) => DT_TEMPLATES.find((x) => x.value === t)?.label ?? t ?? '—';

export type DtSummary = { kw?: number; kva?: number; boards?: number; fails?: number; brand?: string; earthing?: string; lpl?: string | null; poles?: string; template?: string };
export type DtFile = {
  id: string;
  title: string;
  inquiry_id: string | null;
  template: string;
  revision: number;
  status: DtStatus;
  archived: boolean;
  summary: DtSummary;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  checked_by: string | null;
  checked_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  inquiries?: { code: string | null; project_name: string | null; inquiry_name: string | null } | null;
};
export type DtRevision = { id: string; revision: number; summary: DtSummary; note: string | null; saved_by: string | null; saved_at: string };
export type DtLog = { id: number; action: string; revision: number | null; note: string | null; by_user: string | null; at: string };

export const DT_ACTION_LABEL: Record<string, string> = {
  created: 'Created',
  saved: 'Saved a new revision',
  submit: 'Sent for check',
  check: 'Checked',
  approve: 'Approved',
  return: 'Returned',
  archived: 'Archived',
  restored: 'Restored',
};

export const dtSummaryText = (s?: DtSummary | null) =>
  s
    ? [s.kw != null ? `${s.kw} kW` : null, s.kva ? `${s.kva} kVA` : null, s.boards != null ? `${s.boards} boards` : null, s.earthing, s.lpl ? `LPL ${s.lpl}` : null, s.fails ? `${s.fails} check${s.fails > 1 ? 's' : ''} failing` : 'checks pass']
        .filter(Boolean)
        .join(' · ')
    : '';

// The calculation page is kept in the database (only these roles can read it); loaded once per session
let engine: { version: string; html: string } | null = null;
export async function loadDesignEngine() {
  if (engine) return engine;
  const { data, error } = await supabase.from('design_tool_engine').select('version, html').order('created_at', { ascending: false }).order('version', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Design Tools are for the GM / DGM, SM Projects and the design team.');
  engine = data as { version: string; html: string };
  return engine;
}

/** Messages between the app and the calculation page */
export type DtState = Record<string, unknown> & { tree?: unknown; tpl?: string };
export type DtDriverRow = { id: string; make: string; model: string; data: Record<string, unknown>; file_path: string | null; file_name: string | null };
export type DtOut =
  | { type: 'dt:ready' }
  | { type: 'dt:loaded' }
  | { type: 'dt:dirty'; dirty: boolean }
  | { type: 'dt:state'; id: number; state: DtState; summary: DtSummary }
  | { type: 'dt:file'; name: string; mime: string; b64: string }
  | { type: 'dt:drvSave'; driver: Record<string, unknown> & { id: string }; file: { name: string; mime: string; b64: string } | null }
  | { type: 'dt:drvOpen'; path: string; name: string };
export type DtIn =
  | { type: 'dt:load'; state: DtState | null; title?: string }
  | { type: 'dt:get'; id: number }
  | { type: 'dt:saved'; title?: string }
  | { type: 'dt:drivers'; list: DtDriverRow[]; saved?: { id: string; file_path: string | null; file_name: string | null }; error?: string };
export type EngineHandle = { send: (m: DtIn) => void };

/** The design team's LED driver library – datasheet values the page checks the breakers against, and the datasheet PDFs */
export async function loadDrivers() {
  const { data, error } = await supabase.from('design_drivers').select('id, make, model, data, file_path, file_name').order('make').order('model');
  if (error) throw new Error(error.message);
  return (data ?? []) as DtDriverRow[];
}
const b64ToBytes = (b64: string) => {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
};
/** Saves a driver from the page; a new datasheet goes to the catalogue store under drivers/ */
export async function saveDriver(driver: Record<string, unknown> & { id: string }, file: { name: string; mime: string; b64: string } | null) {
  let path: string | null = null;
  if (file) {
    path = `drivers/${driver.id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)}`;
    const up = await supabase.storage.from('catalog').upload(path, b64ToBytes(file.b64), { contentType: file.mime || 'application/pdf' });
    if (up.error) throw new Error(up.error.message);
  }
  await rpc('design_driver_save', { p_id: driver.id, p_data: driver, p_file_path: path, p_file_name: file?.name ?? null });
  return { id: driver.id, file_path: path, file_name: file?.name ?? null };
}
/** Opens a driver datasheet from the library (short-lived link) */
export async function openDriverSheet(path: string, name: string) {
  const { data, error } = await supabase.storage.from('catalog').createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  if (Platform.OS === 'web') window.open(data.signedUrl, '_blank');
  else await Linking.openURL(data.signedUrl);
  return name;
}
