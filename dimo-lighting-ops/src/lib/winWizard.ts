// Win Probability Wizard – the scoring model (testing stage).
// Final = Go (the project goes ahead) × Get (we win it). Get compares our strength with each competitor across four
// pillars – Contractor, Consultant, Product, Client – weighted by how the decision is made, then applies control,
// veto and hard caps. A people pillar can be "not yet known" (scored neutral, lowers confidence) or "not on this
// project" (its weight is shared by the others). Product is always scored.

export type PillarKey = 'contractor' | 'consultant' | 'product' | 'client';
export type PeoplePillar = Exclude<PillarKey, 'product'>;
export type PillarState = 'present' | 'unknown' | 'absent';
export type DecisionType = 'unknown' | 'spec' | 'price' | 'owner' | 'db';
export type Control = 'controlled' | 'contact' | 'none';
export type Basis = 'price' | 'technical' | 'experience' | 'relationship';

export const PILLARS: { k: PillarKey; l: string }[] = [
  { k: 'contractor', l: 'Contractor' },
  { k: 'consultant', l: 'Consultant' },
  { k: 'product', l: 'Product' },
  { k: 'client', l: 'Client' },
];
export const PEOPLE_PILLARS = PILLARS.filter((p) => p.k !== 'product') as { k: PeoplePillar; l: string }[];

export const DECISION_TYPES: Record<DecisionType, { l: string; h: string; w: [number, number, number, number]; tr: [number, number, number] }> = {
  unknown: { l: 'Not yet known', h: 'All pillars equal until you know who decides.', w: [25, 25, 25, 25], tr: [0.4, 0.4, 0.2] },
  spec: { l: 'Specification-driven', h: 'The consultant specifies; product and consultant matter most.', w: [10, 35, 35, 20], tr: [0.6, 0.25, 0.15] },
  price: { l: 'Price-driven or tender', h: 'The lowest compliant price usually wins.', w: [20, 15, 35, 30], tr: [0.25, 0.6, 0.15] },
  owner: { l: 'Owner-driven', h: 'The owner or the client team decides directly.', w: [15, 15, 20, 50], tr: [0.4, 0.4, 0.2] },
  db: { l: 'Design and build', h: 'The contractor designs and buys.', w: [40, 15, 25, 20], tr: [0.4, 0.4, 0.2] },
};

export const GO = {
  funding: { confirmed: { l: 'Confirmed', v: 1 }, likely: { l: 'Likely', v: 0.8 }, uncertain: { l: 'Uncertain', v: 0.5 } },
  approvals: { received: { l: 'Received', v: 1 }, pending: { l: 'Pending', v: 0.9 }, notstarted: { l: 'Not started', v: 0.75 } },
  stage: { construction: { l: 'Construction', v: 1 }, tender: { l: 'Tender', v: 0.95 }, design: { l: 'Detailed design', v: 0.85 }, concept: { l: 'Concept', v: 0.6 } },
};
export type Funding = keyof typeof GO.funding;
export type Approvals = keyof typeof GO.approvals;
export type GoStage = keyof typeof GO.stage;

export const AUTHORITY: Record<number, string> = { 4: '4 · Final approval', 3: '3 · Decides or specifies', 2: '2 · Recommends', 1: '1 · Influences' };
export const BASIS: Record<Basis, string> = { price: 'Price', technical: 'Technical', experience: 'Past experience', relationship: 'Relationship' };
export const CONTROL: Record<Control, string> = { controlled: 'Controlled', contact: 'Contact only', none: 'No access' };
export const LOCK = {
  named: { l: 'Named brand only', m: 1, c: 1 },
  orequal: { l: 'Named “or equal”', m: 0.85, c: 0.5 },
  open: { l: 'Open or not listed', m: 0.7, c: 0 },
};
export type Lock = keyof typeof LOCK;
const FIX: Record<Basis, string> = {
  price: 'review the offer, payment terms or value engineering',
  technical: 'arrange samples, a test, a presentation or a compliance sheet',
  experience: 'share references, arrange a site visit or offer a stronger warranty',
  relationship: 'set up a senior meeting and keep regular follow-up',
};

/** Standard roles offered per pillar (the sales person adds, renames or removes – projects differ) */
export const ROLE_LIBRARY: Record<PeoplePillar, string[]> = {
  contractor: ['Main contractor – Project Manager', 'Main contractor – Project Director', 'MEP contractor – Project Manager', 'MEP contractor – Electrical Engineer', 'Procurement Manager', 'Quantity Surveyor', 'Site Engineer', 'ID contractor – Project Manager'],
  consultant: ['MEP consultant – Electrical Engineer', 'Electrical consultant', 'Principal Architect', 'Interior Designer', 'Lighting Designer', 'Project Management consultant', 'Quantity Surveyor'],
  client: ['Owner', 'Client – Project Director', 'Client – Project Engineer', 'Procurement committee', 'Facility Manager', 'Chief Engineer (authority)'],
};

export type Person = {
  id: number;
  pillar: PeoplePillar;
  org: string;
  role: string;
  name: string;
  contact_id?: string | null;
  organization_id?: string | null;
  reports: number; // id of the person they report to, 0 = top
  infl: number; // id of the person who influences them, 0 = nobody
  auth: number; // 1–4
  support: number; // 0–10
  basis: Basis;
  control: Control;
  evidence: 'verified' | 'assumed';
  days: number; // since last contact
  rival: boolean;
  veto: boolean;
};
export type TeamMember = { id: number; role: string; side: 'ours' | 'rival'; strength: number };
export type Competitor = { name: string; contractor: number; consultant: number; product: number; client: number };

export type WinMap = {
  v: 1;
  type: DecisionType;
  w: [number, number, number, number];
  funding: Funding;
  approvals: Approvals;
  stage: GoStage;
  pillars: Record<PeoplePillar, { state: PillarState; reason: string }>;
  people: Person[];
  removed: { role: string; org: string; auth: number; reason: string; at: string }[];
  product: { T: number; R: number; M: number; lock: Lock; mand: boolean; budget: boolean; team: TeamMember[] };
  comps: Competitor[];
  gut: number;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const label = (p: Person) => [p.name, p.role || 'Role', p.org || 'Organization'].filter(Boolean).join(' · ');

export function baseSupport(p: Person) {
  if (p.control === 'none') return p.rival ? 3 : 5;
  let s = Number(p.support);
  if (p.evidence === 'assumed') s = 5 + (s - 5) * 0.5;
  if (p.days > 30) s -= Math.ceil((p.days - 30) / 30);
  if (p.rival) s -= 1;
  return clamp(s, 0, 10);
}
export function effSupport(p: Person, m: WinMap) {
  let s = baseSupport(p);
  if (p.infl) {
    const i = m.people.find((o) => o.id === p.infl);
    if (i && i.id !== p.id) {
      const b = baseSupport(i);
      if (b >= 7) s += 1;
      else if (b <= 3) s -= 1;
    }
  }
  return clamp(s, 0, 10);
}
/** Pillar weights after the "not on this project" pillars give theirs to the others (total 1) */
export function weightsOf(m: WinMap) {
  const w = m.w.map((x, i) => {
    const k = PILLARS[i].k;
    return k !== 'product' && m.pillars[k].state === 'absent' ? 0 : Math.max(0, Number(x) || 0);
  });
  const t = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / t);
}
const teamFactor = (m: WinMap, side: 'ours' | 'rival') => {
  const t = m.product.team.filter((x) => x.side === side);
  return t.length ? 0.85 + 0.03 * (t.reduce((a, x) => a + x.strength, 0) / t.length) : 1;
};

export type PillarScore = { x: number; c: number; n: number; state: PillarState | 'scored' };
export type WinResult = {
  w: number[];
  go: number;
  pil: Record<PillarKey, PillarScore>;
  sUs: number;
  rivals: { name: string; s: number }[];
  share: number;
  K: number;
  cf: number;
  V: number;
  vetoBy: string | null;
  cap: number;
  capWhy: string[];
  get: number;
  final: number;
  conf: number;
  warnings: string[];
  actions: string[];
};

export function compute(m: WinMap): WinResult {
  const w = weightsOf(m);
  const t = DECISION_TYPES[m.type] ?? DECISION_TYPES.unknown;
  const go = GO.funding[m.funding].v * GO.approvals[m.approvals].v * GO.stage[m.stage].v;
  const active = (p: Person) => m.pillars[p.pillar].state === 'present';
  const people = m.people.filter(active);
  const pil = {} as Record<PillarKey, PillarScore>;
  for (const Q of PEOPLE_PILLARS) {
    const st = m.pillars[Q.k].state;
    const ps = people.filter((p) => p.pillar === Q.k);
    const A = ps.reduce((a, p) => a + p.auth, 0);
    if (st !== 'present' || !ps.length || !A) {
      pil[Q.k] = { x: 0.5, c: 0, n: ps.length, state: st === 'present' ? 'unknown' : st };
      continue;
    }
    const x = ps.reduce((a, p) => a + p.auth * effSupport(p, m), 0) / (10 * A);
    const c = ps.filter((p) => p.control === 'controlled' && effSupport(p, m) >= 6).reduce((a, p) => a + p.auth, 0) / A;
    pil[Q.k] = { x: Math.max(0.05, x), c, n: ps.length, state: 'scored' };
  }
  const pr = m.product;
  const lk = LOCK[pr.lock];
  const xp =
    (Math.exp(t.tr[0] * Math.log(Math.max(0.5, pr.T)) + t.tr[1] * Math.log(Math.max(0.5, pr.R)) + t.tr[2] * Math.log(Math.max(0.5, pr.M))) / 10) *
    lk.m *
    teamFactor(m, 'ours');
  pil.product = { x: clamp(xp, 0.05, 1), c: lk.c, n: pr.team.length, state: 'scored' };

  const sUs = Math.exp(PILLARS.reduce((a, Q, i) => a + w[i] * Math.log(pil[Q.k].x), 0));
  const rf = teamFactor(m, 'rival');
  const comps = m.comps.length ? m.comps : [{ name: 'Competitor', contractor: 6, consultant: 6, product: 6, client: 6 }];
  const rivals = comps.map((c) => ({
    name: c.name || 'Competitor',
    s: Math.exp(PILLARS.reduce((a, Q, i) => a + w[i] * Math.log(clamp((c[Q.k] / 10) * (Q.k === 'product' ? rf : 1), 0.05, 1)), 0)),
  }));
  const share = Math.pow(sUs, 6) / (Math.pow(sUs, 6) + rivals.reduce((a, r) => a + Math.pow(r.s, 6), 0));
  const K = PILLARS.reduce((a, Q, i) => a + w[i] * pil[Q.k].c, 0);
  const cf = 0.5 + 0.5 * K;

  let V = 1;
  let vetoBy: string | null = null;
  for (const p of people.filter((x) => x.veto)) {
    const v = Math.min(1, effSupport(p, m) / 5);
    if (v < V) {
      V = v;
      vetoBy = `${p.role} (${p.org || '—'})`;
    }
  }
  let get = share * cf * V;
  let cap = 1;
  const capWhy: string[] = [];
  const finals = people.filter((p) => p.auth === 4);
  for (const p of finals)
    if (effSupport(p, m) <= 2) {
      cap = Math.min(cap, 0.1);
      capWhy.push(`Final authority (${p.role}) is against us: capped at 10%`);
    }
  for (const p of people.filter((x) => x.auth === 3))
    if (effSupport(p, m) <= 2) {
      cap = Math.min(cap, 0.3);
      capWhy.push(`Decision-maker (${p.role}) is against us: capped at 30%`);
    }
  for (const k of [...new Set(finals.map((p) => p.pillar))])
    if (pil[k].c === 0) {
      cap = Math.min(cap, 0.3);
      capWhy.push(`No control in the ${k} pillar, which holds the final authority: capped at 30%`);
    }
  if (pr.mand) {
    cap = 0;
    capWhy.push('Fails a mandatory specification item: 0%');
  }
  if (pr.budget) {
    cap = 0;
    capWhy.push('Above the confirmed budget without approval: 0%');
  }
  get = Math.min(get, cap);
  const final = go * get;

  // Confidence: share of decision weight that is verified and reached; lower while pillars are not yet known
  const totA = people.reduce((a, p) => a + p.auth, 0);
  const verA = people.filter((p) => p.evidence === 'verified' && p.control !== 'none').reduce((a, p) => a + p.auth, 0);
  const unknown = PEOPLE_PILLARS.filter((Q) => m.pillars[Q.k].state === 'unknown').length;
  const conf = (totA ? verA / totA : 0) * Math.pow(0.8, unknown);

  const warnings: string[] = [];
  if (!finals.length) warnings.push('Nobody is marked as final approval (4) – find out who gives the final approval.');
  for (const Q of PEOPLE_PILLARS) {
    if (m.pillars[Q.k].state === 'unknown') warnings.push(`${Q.l}: not yet known – scored as neutral until the people are mapped.`);
    if (m.pillars[Q.k].state === 'absent' && !m.pillars[Q.k].reason.trim()) warnings.push(`${Q.l}: marked not on this project – give the reason.`);
  }
  if (vetoBy && V < 1) warnings.push(`Veto holder ${vetoBy} lowers the result to ${Math.round(V * 100)}% of its value.`);

  // Next actions: the decision-makers holding us back, by what drives their view
  const actions = people
    .filter((p) => p.auth >= 2 && effSupport(p, m) < 6)
    .sort((a, b) => b.auth - a.auth || effSupport(a, m) - effSupport(b, m))
    .slice(0, 5)
    .map((p) =>
      p.control === 'none'
        ? `Reach ${p.role}${p.org ? ` (${p.org})` : ''} – nobody has access yet`
        : `${p.role}${p.org ? ` (${p.org})` : ''}: ${FIX[p.basis]}`,
    );
  for (const p of people.filter((x) => x.days > 30 && x.auth >= 3).slice(0, 2)) actions.push(`Visit ${p.role} – no contact for ${p.days} days`);
  if (pr.lock !== 'named') actions.push('Work with the consultant to name our brand in the specification');

  return { w, go, pil, sUs, rivals, share, K, cf, V, vetoBy, cap, capWhy, get, final, conf, warnings, actions };
}

/** Points for SM Projects' review (stored with the score) */
export function flagsOf(m: WinMap, r: WinResult, currentPct: number): string[] {
  const f: string[] = [];
  const wiz = Math.round(r.final * 100);
  if (Math.abs(wiz - currentPct) >= 20) f.push(`Wizard ${wiz}% vs current ${currentPct}%`);
  if (Math.abs(m.gut - wiz) >= 20) f.push(`Gut feel ${m.gut}% vs wizard ${wiz}%`);
  if (r.conf < 0.4) f.push(`Low confidence (${pct(r.conf)})`);
  for (const Q of PEOPLE_PILLARS) if (m.pillars[Q.k].state === 'absent') f.push(`${Q.l} pillar marked not on this project: ${m.pillars[Q.k].reason || 'no reason'}`);
  for (const x of m.removed.filter((y) => y.auth >= 3)) f.push(`Removed ${x.role}${x.org ? ` (${x.org})` : ''}: ${x.reason}`);
  return f;
}

export const blankPerson = (id: number, pillar: PeoplePillar, role = '', o: Partial<Person> = {}): Person => ({
  id,
  pillar,
  org: '',
  role,
  name: '',
  reports: 0,
  infl: 0,
  auth: 2,
  support: 5,
  basis: 'technical',
  control: 'contact',
  evidence: 'assumed',
  days: 0,
  rival: false,
  veto: false,
  ...o,
});

// Category of a project stakeholder (visit category) → pillar
export function pillarOfCategory(cat: string): PeoplePillar | null {
  const c = cat.toLowerCase();
  if (c.includes('contractor')) return 'contractor';
  if (c.includes('consultant') || c.includes('architect') || c.includes('designer') || c.includes('surveyor')) return 'consultant';
  if (c.includes('client') || c.includes('developer') || c.includes('government') || c.includes('authority')) return 'client';
  return null;
}
