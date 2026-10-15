import { supabase } from './supabase';
import type { Role } from './types';

/** Lighting Academy (Sales Tools → Dacademy): the lessons are a static page; progress is saved through the person's own sign-in */
export const ACADEMY_PATH = '/academy/index.html';
export const ACADEMY_SITE = 'https://dimo-lighting-ops.vercel.app';
export const ACADEMY_TEAM_VIEWERS: Role[] = ['sm_projects', 'gm', 'sys_admin'];

export type AcademyCfg = { sb: string; key: string; token: string; name: string };
export type AcademyMember = { user_id: string; full_name: string; role: string; lessons_done: number; attempts: number; avg_best: number | null; last_at: string | null };

/** What the Academy page needs to save progress: the database address, the public key and the person's current sign-in */
export async function academyCfg(name: string): Promise<AcademyCfg | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const sb = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return token && sb && key ? { sb, key, token, name } : null;
}

/** The link the phone app opens: the settings travel after the # so they never reach a server log */
export function academyLink(cfg: AcademyCfg | null) {
  if (!cfg) return `${ACADEMY_SITE}${ACADEMY_PATH}`;
  const json = JSON.stringify(cfg);
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : '';
  return `${ACADEMY_SITE}${ACADEMY_PATH}#cfg=${encodeURIComponent(b64)}`;
}
