import { supabase } from './supabase';
import type { Role } from './types';

/** Lighting Academy (Sales Tools → Dacademy): the lessons are a static page; progress is saved through the person's own sign-in */
export const ACADEMY_PATH = '/academy/index.html';

/** The Dacademy courses: each is a static page of lessons; progress is kept per lesson in the same table (ids start net_ / knx_ / knxlab_ for the newer courses) */
export type AcademyCourse = 'light' | 'net' | 'knx' | 'knxlab' | 'infra' | 'bs7671' | 'elecfix';
/** group: courses shown together under one tab (with a second selector by their short name) */
export const ACADEMY_COURSES: { value: AcademyCourse; label: string; path: string; lessons: number; group?: string; short?: string }[] = [
  { value: 'light', label: 'Lighting', path: ACADEMY_PATH, lessons: 152 },
  { value: 'net', label: 'Network & IT', path: '/academy/net.html', lessons: 20 },
  { value: 'knx', label: 'KNX – JUNG', path: '/academy/knx.html', lessons: 30 },
  { value: 'knxlab', label: 'KNX Studio', path: '/academy/knxlab.html', lessons: 14 }, // ETS-style project trainer: 14 self-checking exercises (8 office + hotel brief + 5 hotel)
  { value: 'infra', label: 'Infrastructure', path: '/academy/infra.html', lessons: 24 }, // 24 sessions with a virtual lab: Cisco-style switches and routers, FortiGate, Windows Server, Ubuntu, Proxmox
  { value: 'bs7671', label: 'Wiring Regulations', path: '/academy/bs7671.html', lessons: 52, group: 'Electrical', short: 'Wiring Regulations' }, // BS 7671:2018+A4:2026 – 48 lessons in 10 modules over three levels + 4 practical assessments, 10 module tests and a final exam
  { value: 'elecfix', label: 'Electrical Troubleshooting', path: '/academy/elec.html', lessons: 43, group: 'Electrical', short: 'Troubleshooting' }, // 8 guided demos, 22 random-fault jobs, 7 LED driver (incl. the 1700 W high-power driver and its trip case) and 6 panel board workbenches
];
/** The course tabs: one per course, or one per group of courses */
export const ACADEMY_TABS = ACADEMY_COURSES.reduce<{ value: string; label: string; courses: AcademyCourse[] }[]>((t, c) => {
  const g = c.group && t.find((x) => x.value === c.group);
  if (g) g.courses.push(c.value);
  else t.push({ value: c.group ?? c.value, label: c.group ?? c.label, courses: [c.value] });
  return t;
}, []);
export const academyTab = (c: AcademyCourse) => ACADEMY_TABS.find((t) => t.courses.includes(c)) ?? ACADEMY_TABS[0];
export const ACADEMY_TOTAL = ACADEMY_COURSES.reduce((t, c) => t + c.lessons, 0);
/** End-of-module tests (public/academy/mtest.js): 15 questions from a pool of 30, passed at 12 – Lighting 13, Network & IT 3, KNX 3, Infrastructure 3, Wiring Regulations 10 (+ its 30-question final exam) */
export const ACADEMY_TESTS = 33;
export const ACADEMY_SITE = 'https://dimo-lighting-ops.vercel.app';
/** The trainers: everyone's progress, write-ups to mark */
export const ACADEMY_TRAINERS: Role[] = ['sm_projects', 'gm', 'sys_admin'];
/** Team progress: the trainers for everyone, the Design Manager for the design team, SM Estimation for the estimation team */
export const ACADEMY_TEAM_VIEWERS: Role[] = [...ACADEMY_TRAINERS, 'design_manager', 'sm_estimation'];
/** The engineers have Dacademy (the Infrastructure course first) but not the rest of Sales Tools */
export const ACADEMY_ENGINEERS: Role[] = ['senior_elec_engineer', 'assistant_engineer', 'trainee'];
/** Estimation has Dacademy (the Lighting course) but not the rest of Sales Tools */
export const ACADEMY_ESTIMATION: Role[] = ['sm_estimation', 'am_estimation', 'estimation_exec'];
/** Roles whose Tools page is Dacademy only */
export const ACADEMY_ONLY: Role[] = [...ACADEMY_ENGINEERS, ...ACADEMY_ESTIMATION];

export type AcademyStatus = 'ahead' | 'on_track' | 'behind' | 'idle' | 'complete' | 'open';
export type AcademyPath = { required: AcademyCourse[]; optional: AcademyCourse[]; months: number | null; start_on: string | null; target_on: string | null; items: number; pace: number; custom: boolean };
export type AcademyState = { items: number; done: number; expected: number; pace: number; this_week: number; status: AcademyStatus; last_at: string | null; idle_weeks: number | null };
export type AcademyLevel = { level: number; name: string; from: number; next: number | null };
export type AcademyCourseState = { course: AcademyCourse; lessons: number; lessons_done: number; tests: number; tests_passed: number; tests_90: number; complete: boolean; completed_at: string | null; required: boolean; optional: boolean };
export type AcademyBadge = { key: string; period: string; awarded_at: string; note: string | null };
export type AcademySpotcheck = { checked_on: string; topic: string; result: 'pass' | 'needs_work'; note: string | null; by: string };
export type AcademyMe = { user_id: string; full_name: string; role: Role; member: boolean; path: AcademyPath; state: AcademyState; points: number; level: AcademyLevel; month_points: number; streak: number; courses: AcademyCourseState[]; badges: AcademyBadge[]; flags_open: number; spotchecks: AcademySpotcheck[] };
export type AcademyTeamRow = { user_id: string; full_name: string; role: Role; points: number; month_points: number; state: AcademyState; path: AcademyPath; tests_passed: number; badges: number; flags_open: number; last_spotcheck: string | null };
export type AcademyLeader = { user_id: string; full_name: string; role: Role; team: string; points: number };
export type AcademyFlag = { id: string; user_id: string; full_name: string; kind: 'fast' | 'attempts' | 'burst'; lesson: string | null; detail: string; created_at: string; reviewed_at: string | null; reviewed_by: string | null; note: string | null };
export type AcademyBadgeDef = { key: string; family: 'course' | 'skill' | 'excellence' | 'habit' | 'contribution'; tier: 'bronze' | 'silver' | 'gold' | 'platinum'; name: string; rule: string; icon: string; points: number; auto: boolean; sort: number };

export const TIER_COLOURS: Record<AcademyBadgeDef['tier'], string> = { bronze: '#B45309', silver: '#6B7280', gold: '#CA8A04', platinum: '#7C3AED' };
export const FAMILY_LABELS: Record<AcademyBadgeDef['family'], string> = { course: 'Course', skill: 'Skill', excellence: 'Excellence', habit: 'Habit', contribution: 'Contribution' };
export const STATUS_LABELS: Record<AcademyStatus, string> = { ahead: 'Ahead', on_track: 'On track', behind: 'Behind', idle: 'Idle', complete: 'Complete', open: 'Optional' };
export const STATUS_COLOURS: Record<AcademyStatus, string> = { ahead: '#047857', on_track: '#1D4ED8', behind: '#B45309', idle: '#C8102E', complete: '#7C3AED', open: '#6B7280' };
export const FLAG_LABELS: Record<AcademyFlag['kind'], string> = { fast: 'Very fast', attempts: 'Many tries', burst: 'Many in a day' };
export const courseLabel = (c: string) => ACADEMY_COURSES.find((x) => x.value === c)?.label ?? c;

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);

/** A course certificate (A4 landscape) in the DIMO colours – navy and lime with the logo's diagonal stripes: name, course, date and the tests passed */
export function certificateHtml(o: { name: string; course: string; date: string; detail: string; logo: string; serial: string }) {
  const stripes = Array.from({ length: 7 }, (_, i) => `<span style="top:${18 + i * 9}mm"></span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 0 }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1F2937 }
.c { position: relative; width: 297mm; height: 210mm; overflow: hidden; background: #fff }
.side { position: absolute; left: 0; top: 0; bottom: 0; width: 62mm; background: #244286 }
.side span { position: absolute; left: 14mm; width: 34mm; height: 4.5mm; background: #B0D035; transform: skewY(-28deg) }
.side .lbl { position: absolute; left: 0; right: 0; bottom: 16mm; text-align: center; color: #fff; font-family: Arial, sans-serif; letter-spacing: 5px; font-size: 13px; font-weight: bold }
.side .lbl small { display: block; color: #B0D035; letter-spacing: 2px; font-size: 10px; font-weight: normal; margin-top: 2mm }
.top { position: absolute; left: 62mm; right: 0; top: 0; height: 3mm; background: #B0D035 }
.bot { position: absolute; left: 62mm; right: 0; bottom: 0; height: 9mm; background: #244286; color: #fff; font-family: Arial, sans-serif; font-size: 11px; display: flex; justify-content: space-between; align-items: center; padding: 0 14mm }
.bot b { color: #B0D035; font-weight: normal }
.m { position: absolute; left: 62mm; right: 0; top: 3mm; bottom: 9mm; padding: 0 18mm 12mm; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center }
img { height: 20mm }
.k { font-family: Arial, sans-serif; letter-spacing: 7px; font-size: 12px; color: #244286; margin-top: 7mm; font-weight: bold }
h1 { font-size: 38px; margin: 3mm 0 0; font-weight: normal; color: #244286 }
.rule { width: 46mm; height: 1.2mm; background: #B0D035; margin: 4mm 0 5mm }
.t { font-size: 15px; color: #4B5563 }
.n { font-size: 34px; color: #111827; border-bottom: 1px solid #244286; padding: 0 14mm 2mm; margin: 4mm 0 5mm }
.co { font-size: 26px; color: #244286; font-weight: bold; margin: 3mm 0 2mm }
.d { font-size: 14px; color: #4B5563 }
.sys { position: absolute; left: 0; right: 0; bottom: 6mm; font-family: Arial, sans-serif; font-size: 10px; color: #6B7280 }
.seal { position: absolute; right: 16mm; bottom: 15mm; width: 30mm; height: 30mm; border-radius: 50%; background: #B0D035; border: 2mm solid #244286; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: Arial, sans-serif; color: #244286; font-weight: bold; font-size: 10px; letter-spacing: 1px; text-align: center; line-height: 1.3 }
.seal i { font-style: normal; font-size: 20px }
</style></head><body><div class="c">
<div class="side">${stripes}<div class="lbl">DIMO<small>LIGHTING SOLUTIONS</small></div></div>
<div class="top"></div>
<div class="m">
<img src="${o.logo}"><div class="k">DIMO LIGHTING SOLUTIONS</div><h1>Certificate of Completion</h1><div class="rule"></div>
<div class="t">This certifies that</div><div class="n">${esc(o.name)}</div>
<div class="t">has completed every lesson and module test of</div><div class="co">${esc(o.course)}</div><div class="d">${esc(o.detail)}</div>
<div class="sys">This certificate is generated by the system and needs no signature.</div>
</div>
<div class="seal"><i>★</i>COURSE<br>COMPLETE</div>
<div class="bot"><span>Completed <b>${esc(o.date)}</b></span><span>DIMO Lighting Solutions</span><span>No. <b>${esc(o.serial)}</b></span></div>
</div></body></html>`;
}

export type AcademyCfg = { sb: string; key: string; token: string; name: string };
export type AcademyWriteup = { id: string; user_id: string; full_name: string; role: string; lesson: string; kind: 'ticket' | 'weekly' | 'test' | 'script' | 'notes'; body: Record<string, unknown>; mark: number | null; feedback: string | null; marked_by_name: string | null; marked_at: string | null; updated_at: string };
export type AcademyMember = { user_id: string; full_name: string; role: string; lessons_done: number; attempts: number; avg_best: number | null; last_at: string | null; tests_passed?: number };

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
