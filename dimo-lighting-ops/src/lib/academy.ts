import { supabase } from './supabase';
import type { Role } from './types';

/** Lighting Academy (Sales Tools → Dacademy): the lessons are a static page; progress is saved through the person's own sign-in */
export const ACADEMY_PATH = '/academy/index.html';

/** The Dacademy courses: each is a static page of lessons; progress is kept per lesson in the same table (ids start net_ / knx_ / knxlab_ for the newer courses) */
export type AcademyCourse = 'light' | 'net' | 'knx' | 'knxlab' | 'infra';
export const ACADEMY_COURSES: { value: AcademyCourse; label: string; path: string; lessons: number }[] = [
  { value: 'light', label: 'Lighting', path: ACADEMY_PATH, lessons: 131 },
  { value: 'net', label: 'Network & IT', path: '/academy/net.html', lessons: 20 },
  { value: 'knx', label: 'KNX – JUNG', path: '/academy/knx.html', lessons: 30 },
  { value: 'knxlab', label: 'KNX Studio', path: '/academy/knxlab.html', lessons: 14 }, // ETS-style project trainer: 14 self-checking exercises (8 office + hotel brief + 5 hotel)
  { value: 'infra', label: 'Infrastructure', path: '/academy/infra.html', lessons: 24 }, // 24 sessions with a virtual lab: Cisco-style switches and routers, FortiGate, Windows Server, Ubuntu, Proxmox
];
export const ACADEMY_TOTAL = ACADEMY_COURSES.reduce((t, c) => t + c.lessons, 0);
export const ACADEMY_SITE = 'https://dimo-lighting-ops.vercel.app';
export const ACADEMY_TEAM_VIEWERS: Role[] = ['sm_projects', 'gm', 'sys_admin'];
/** The engineers have Dacademy (the Infrastructure course first) but not the rest of Sales Tools */
export const ACADEMY_ENGINEERS: Role[] = ['senior_elec_engineer', 'assistant_engineer', 'trainee'];

export type AcademyCfg = { sb: string; key: string; token: string; name: string };
export type AcademyWriteup = { id: string; user_id: string; full_name: string; role: string; lesson: string; kind: 'ticket' | 'weekly' | 'test' | 'script' | 'notes'; body: Record<string, unknown>; mark: number | null; feedback: string | null; marked_by_name: string | null; marked_at: string | null; updated_at: string };
export type AcademyMember = { user_id: string; full_name: string; role: string; lessons_done: number; attempts: number; avg_best: number | null; last_at: string | null };

/** What the Academy page needs to save progress: the database address, the public key and the person's current sign-in */
export async function academyCfg(name: string): Promise<AcademyCfg | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const sb = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return token && sb && key ? { sb, key, token, name } : null;
}

/** The link the phone app opens: the settings travel after the # so they never reach a server log */
export function academyLink(cfg: AcademyCfg | null, path = ACADEMY_PATH) {
  if (!cfg) return `${ACADEMY_SITE}${path}`;
  const json = JSON.stringify(cfg);
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : '';
  return `${ACADEMY_SITE}${path}#cfg=${encodeURIComponent(b64)}`;
}
