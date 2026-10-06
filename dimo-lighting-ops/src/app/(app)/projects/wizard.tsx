import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { WinGraphic } from '@/components/WinGraphic';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MILESTONES } from '@/lib/constants';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Milestone, Project } from '@/lib/types';
import {
  AUTHORITY,
  BASIS,
  blankPerson,
  compute,
  CONTROL,
  DECISION_TYPES,
  type DecisionType,
  flagsOf,
  GO,
  label,
  LOCK,
  type Lock,
  PEOPLE_PILLARS,
  type PeoplePillar,
  type Person,
  pct,
  PILLARS,
  pillarOfCategory,
  ROLE_LIBRARY,
  type WinMap,
  effSupport,
} from '@/lib/winWizard';

type Score = { id: number; scored_at: string; scored_by: string; wizard_pct: number; manual_pct: number | null; chosen_pct: number | null; applied: string; confidence: number | null };
const STEPS = ['Project', 'People', 'Product', 'Competitors', 'Gut feel', 'Result'] as const;
const PILLAR_TONE: Record<string, string> = { contractor: '#1F2A44', consultant: '#4A6A8A', product: '#B07A1F', client: '#8A6D3B' };

/** 0–10 scale as tappable numbers (works the same on phones and the web) */
function Scale({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Row gap={4} wrap>
      {Array.from({ length: 11 }, (_, i) => (
        <Pressable
          key={i}
          disabled={disabled}
          onPress={() => onChange(i)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: i === value ? colors.ink : colors.line,
            backgroundColor: i === value ? colors.ink : '#fff',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text style={{ color: i === value ? '#fff' : colors.ink, fontWeight: '600' }}>{i}</Text>
        </Pressable>
      ))}
    </Row>
  );
}

const lockOf = (spec: string): Lock => (spec === 'our_brand' ? 'named' : spec === 'open' ? 'orequal' : 'open');
const stageOf = (m: Milestone): WinMap['stage'] =>
  m === 'lead_identified' ? 'concept' : m === 'design_involvement' || m === 'brand_specified' ? 'design' : m === 'loa_expected' ? 'construction' : 'tender';

/** A first map from what the system already knows: stakeholders and their contacts, visits, competitors mentioned */
async function initialMap(p: Project): Promise<WinMap> {
  const [st, vis] = await Promise.all([
    supabase.from('project_stakeholders').select('category, organization_id, contact_id, organizations(name), contacts(name, designation)').eq('project_id', p.id),
    supabase.from('visits').select('organization_id, contact_id, checkin_at, competitors_mentioned').eq('project_id', p.id).order('checkin_at', { ascending: false }).limit(200),
  ]);
  const visits = (vis.data ?? []) as { organization_id: string; contact_id: string | null; checkin_at: string; competitors_mentioned: string[] | null }[];
  const daysSince = (org: string | null, contact: string | null) => {
    const v = visits.find((x) => (contact && x.contact_id === contact) || (!contact && x.organization_id === org));
    return v ? Math.max(0, Math.round((Date.now() - Date.parse(v.checkin_at)) / 864e5)) : 60;
  };
  let id = 0;
  const people: Person[] = [];
  for (const s of (st.data ?? []) as unknown as {
    category: string;
    organization_id: string;
    contact_id: string | null;
    organizations: { name: string } | null;
    contacts: { name: string; designation: string | null } | null;
  }[]) {
    const pillar = pillarOfCategory(s.category);
    if (!pillar) continue;
    people.push(
      blankPerson(++id, pillar, s.contacts?.designation || s.category, {
        org: s.organizations?.name ?? '',
        name: s.contacts?.name ?? '',
        contact_id: s.contact_id,
        organization_id: s.organization_id,
        days: daysSince(s.organization_id, s.contact_id),
        auth: pillar === 'client' ? 3 : 2,
      }),
    );
  }
  const templates: Record<PeoplePillar, [string, number, boolean][]> = {
    contractor: [['Main contractor – Project Manager', 2, false], ['MEP contractor – Project Manager', 3, false]],
    consultant: [['MEP consultant – Electrical Engineer', 3, false], ['Principal Architect', 2, false]],
    client: [['Owner', 4, true], ['Client – Project Director', 3, true]],
  };
  const pillars = {} as WinMap['pillars'];
  for (const Q of PEOPLE_PILLARS) {
    const has = people.some((x) => x.pillar === Q.k);
    pillars[Q.k] = { state: has ? 'present' : 'unknown', reason: '' };
    if (!has) for (const [role, auth, veto] of templates[Q.k]) people.push(blankPerson(++id, Q.k, role, { auth, veto, days: 0 }));
  }
  const comps = [...new Set(visits.flatMap((v) => v.competitors_mentioned ?? []))].slice(0, 3).map((name) => ({ name, contractor: 6, consultant: 6, product: 6, client: 6 }));
  const type: DecisionType = p.project_type === 'infrastructure' || p.project_type === 'industrial' ? 'price' : 'spec';
  return {
    v: 1,
    type,
    w: [...DECISION_TYPES[type].w],
    funding: 'likely',
    approvals: 'pending',
    stage: stageOf(p.milestone),
    pillars,
    people,
    removed: [],
    product: { T: 6, R: 5, M: 6, lock: lockOf(p.spec_status), mand: false, budget: false, team: [] },
    comps: comps.length ? comps : [{ name: '', contractor: 6, consultant: 6, product: 6, client: 6 }],
    gut: p.win_probability,
  };
}

/** Win Probability Wizard for one project (testing stage – used when the project's wizard tick is on) */
export default function WinWizard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [m, setM] = useState<WinMap | null>(null);
  const [step, setStep] = useState(0);
  const { data, error, reload } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('projects').select('*, organizations(name)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const project = p as Project & { use_wizard?: boolean };
    const [{ data: saved }, { data: scores }] = await Promise.all([
      supabase.from('win_maps').select('data, updated_at').eq('project_id', id).maybeSingle(),
      supabase.from('win_scores').select('id, scored_at, scored_by, wizard_pct, manual_pct, chosen_pct, applied, confidence').eq('project_id', id).order('scored_at', { ascending: false }).limit(12),
    ]);
    const map = saved?.data ? (saved.data as WinMap) : await initialMap(project);
    return { project, map, savedAt: (saved?.updated_at as string | undefined) ?? null, scores: (scores ?? []) as Score[] };
  }, [id]);
  const map = m ?? data?.map ?? null;
  const R = useMemo(() => (map ? compute(map) : null), [map]);
  // How the % moved with each change in this session (for the live picture)
  const [trail, setTrail] = useState<number[]>([]);
  const now = R ? Math.round(R.final * 100) : null;
  if (now != null && trail[trail.length - 1] !== now) setTrail([...trail, now].slice(-60));
  if (!data || !map || !R) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data.project;
  const canScore = p.owner_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const manager = me.role === 'sm_projects' || me.role === 'gm';
  const set = (patch: Partial<WinMap>) => setM({ ...map, ...patch });
  const setPerson = (pid: number, patch: Partial<Person>) => {
    const person = map.people.find((x) => x.id === pid);
    // Filling in someone in a "not yet known" pillar means the pillar is now known
    const pillars =
      person && map.pillars[person.pillar].state === 'unknown' && ('support' in patch || 'org' in patch || 'name' in patch || 'control' in patch)
        ? { ...map.pillars, [person.pillar]: { state: 'present' as const, reason: '' } }
        : map.pillars;
    setM({ ...map, pillars, people: map.people.map((x) => (x.id === pid ? { ...x, ...patch } : x)) });
  };
  const value = p.lighting_value ?? p.project_value ?? 0;
  const wiz = Math.round(R.final * 100);

  const removePerson = async (x: Person) => {
    let reason = '';
    if (x.auth >= 3) {
      const r = await dialog.prompt({
        title: `Remove ${x.role}?`,
        message: 'This person decides or approves. Removing them changes the score – SM Projects sees the reason in the review.',
        fields: [{ key: 'r', label: 'Why is this role not on the project?', type: 'multiline', required: true }],
        confirmLabel: 'Remove',
      });
      if (!r) return;
      reason = r.r;
    }
    setM({
      ...map,
      people: map.people.filter((y) => y.id !== x.id).map((y) => ({ ...y, reports: y.reports === x.id ? 0 : y.reports, infl: y.infl === x.id ? 0 : y.infl })),
      removed: x.auth >= 3 ? [...map.removed, { role: x.role, org: x.org, auth: x.auth, reason, at: new Date().toISOString() }] : map.removed,
    });
  };
  const addPerson = async (pillar: PeoplePillar) => {
    const r = await dialog.prompt({
      title: `Add a role – ${PILLARS.find((q) => q.k === pillar)?.l}`,
      fields: [
        { key: 'role', label: 'Standard role', type: 'select', options: [...ROLE_LIBRARY[pillar].map((v) => ({ value: v, label: v })), { value: '_other', label: 'Other (type below)' }] },
        { key: 'custom', label: 'Or a role of your own (e.g. a sub-role)' },
        { key: 'org', label: 'Organization' },
        { key: 'name', label: 'Name (optional)' },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    const role = r.custom?.trim() || (r.role && r.role !== '_other' ? r.role : '');
    if (!role) return dialog.toast('Choose or type the role', 'error');
    const nid = Math.max(0, ...map.people.map((x) => x.id)) + 1;
    setM({
      ...map,
      pillars: map.pillars[pillar].state === 'present' ? map.pillars : { ...map.pillars, [pillar]: { state: 'present', reason: '' } },
      people: [...map.people, blankPerson(nid, pillar, role, { org: r.org ?? '', name: r.name ?? '', days: 0 })],
    });
  };

  const saveScore = async (apply: boolean) => {
    if (!canScore) return;
    for (const Q of PEOPLE_PILLARS)
      if (map.pillars[Q.k].state === 'absent' && !map.pillars[Q.k].reason.trim()) return dialog.toast(`Give the reason the ${Q.l.toLowerCase()} pillar is not on this project`, 'error');
    let applyArgs: { pct: number; reason: string } | null = null;
    if (apply) {
      const r = await dialog.prompt({
        title: manager ? 'Set the win probability' : 'Send the win probability to SM Projects',
        message: `The wizard gives ${wiz}%. The project is at ${p.win_probability}%. Choose the % to use.`,
        fields: [
          { key: 'pct', label: 'Win probability %', initial: String(wiz), required: true },
          { key: 'reason', label: 'Comment', type: 'multiline' },
        ],
        confirmLabel: manager ? 'Set' : 'Send for approval',
      });
      if (!r) return;
      applyArgs = { pct: Number(r.pct), reason: r.reason ?? '' };
      if (!(applyArgs.pct >= 0 && applyArgs.pct <= 100)) return dialog.toast('Win probability is 0 – 100', 'error');
    }
    await dialog.run(
      async () => {
        const sid = await rpc<number>('save_win_score', {
          p_project: p.id,
          p_data: map,
          p_result: { final: R.final, go: R.go, get: R.get, share: R.share, cf: R.cf, V: R.V, cap: R.cap, capWhy: R.capWhy, pillars: R.pil, weights: R.w },
          p_wizard: wiz,
          p_gut: map.gut,
          p_confidence: Math.round(R.conf * 100),
          p_flags: flagsOf(map, R, p.win_probability),
        });
        if (applyArgs) await rpc('apply_win_score', { p_score: sid, p_pct: applyArgs.pct, p_milestone: p.milestone, p_reason: applyArgs.reason || null });
        setM(null);
        await reload();
      },
      !applyArgs ? 'Score saved' : manager ? 'Win probability set' : 'Sent to SM Projects for approval',
    );
  };

  const pillarHead = (k: PeoplePillar, l: string) => (
    <View style={{ gap: 6 }}>
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: PILLAR_TONE[k] }} />
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{l}</Text>
        </Row>
        <Segmented
          value={map.pillars[k].state}
          onChange={(st) => set({ pillars: { ...map.pillars, [k]: { ...map.pillars[k], state: st } } })}
          options={[
            { value: 'present', label: 'On this project' },
            { value: 'unknown', label: 'Not yet known' },
            { value: 'absent', label: 'Not on this project' },
          ]}
        />
      </Row>
      {map.pillars[k].state === 'absent' ? (
        <Field
          label={`Why is there no ${l.toLowerCase()} on this project? (SM Projects sees this)`}
          required
          value={map.pillars[k].reason}
          onChangeText={(v) => set({ pillars: { ...map.pillars, [k]: { state: 'absent', reason: v } } })}
          placeholder={k === 'consultant' ? 'e.g. direct purchase by the owner, no consultant appointed' : 'e.g. supply-only order to the client'}
        />
      ) : map.pillars[k].state === 'unknown' ? (
        <Muted>Scored as neutral and confidence is lower until the people are known. Fill a person in and the pillar counts.</Muted>
      ) : null}
    </View>
  );

  const personCard = (x: Person) => {
    const others = [{ value: '0', label: 'Nobody' }, ...map.people.filter((o) => o.id !== x.id).map((o) => ({ value: String(o.id), label: label(o) }))];
    return (
      <Card key={x.id} style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: PILLAR_TONE[x.pillar] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{label(x)}</Text>
          <Row gap={6}>
            {x.veto ? <Pill label="Veto" tone={colors.red} /> : null}
            <Button small variant="ghost" title="Remove" onPress={() => removePerson(x)} />
          </Row>
        </Row>
        <Grid min={220}>
          <Field label="Role" value={x.role} onChangeText={(v) => setPerson(x.id, { role: v })} />
          <Field label="Organization" value={x.org} onChangeText={(v) => setPerson(x.id, { org: v })} />
          <Field label="Name (optional)" value={x.name} onChangeText={(v) => setPerson(x.id, { name: v })} />
          <Select label="Authority on our package" value={String(x.auth)} options={Object.entries(AUTHORITY).reverse().map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setPerson(x.id, { auth: Number(v) })} />
          <Select label="Our control" value={x.control} options={Object.entries(CONTROL).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setPerson(x.id, { control: v as Person['control'] })} />
          <Select label="What drives their view" value={x.basis} options={Object.entries(BASIS).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setPerson(x.id, { basis: v as Person['basis'] })} />
          <Select
            label="Evidence"
            value={x.evidence}
            options={[
              { value: 'verified', label: 'Verified (they said or did it)' },
              { value: 'assumed', label: 'Assumed' },
            ]}
            onChange={(v) => setPerson(x.id, { evidence: v as Person['evidence'] })}
          />
          <Field label="Days since last contact" keyboardType="number-pad" value={String(x.days)} onChangeText={(v) => setPerson(x.id, { days: Math.max(0, Number(v.replace(/\D/g, '')) || 0) })} />
          <Select label="Reports to" value={String(x.reports)} options={others} onChange={(v) => setPerson(x.id, { reports: Number(v) })} />
          <Select label="Influenced by" value={String(x.infl)} options={others} onChange={(v) => setPerson(x.id, { infl: Number(v) })} />
        </Grid>
        <Text style={{ fontWeight: '600', color: colors.ink }}>Support for us (0 backs a rival · 5 neutral · 10 champion)</Text>
        <Scale value={x.support} onChange={(v) => setPerson(x.id, { support: v })} disabled={x.control === 'none'} />
        <Muted>{`Used after adjustments: ${effSupport(x, map).toFixed(1)}${x.control === 'none' ? ' (no access – counted as neutral, or 3 if a rival is close)' : ''}`}</Muted>
        <Row wrap gap={16}>
          <Toggle label="Can accept or reject on their own (veto)" value={x.veto} onChange={(v) => setPerson(x.id, { veto: v })} />
          <Toggle label="A competitor is close to this person" value={x.rival} onChange={(v) => setPerson(x.id, { rival: v })} />
        </Row>
      </Card>
    );
  };

  return (
    <Screen maxWidth={980}>
      <Stack.Screen options={{ title: `Win probability · ${p.code}` }} />
      {/* Live result */}
      <Card style={{ gap: 8 }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{p.name}</Text>
            <Muted>{`${p.organizations?.name ?? ''} · now ${p.win_probability}% (${MILESTONES.find((x) => x.value === p.milestone)?.label ?? p.milestone})`}</Muted>
          </View>
          <Pill label="Wizard · testing" tone={colors.blue} />
        </Row>
        <Row wrap gap={10} style={{ alignItems: 'stretch' }}>
          {(
            [
              ['Wizard win', pct(R.final), R.final >= 0.6 ? colors.green : R.final >= 0.35 ? colors.amber : colors.red],
              ['Go – project happens', pct(R.go), colors.ink],
              ['Get – we win it', pct(R.get), colors.ink],
              ['Confidence (verified)', pct(R.conf), R.conf >= 0.7 ? colors.green : R.conf >= 0.4 ? colors.amber : colors.red],
              ...(value ? [['Expected value', fmtMoney(value * R.final, p.currency), colors.ink]] : []),
            ] as [string, string, string][]
          ).map(([l, v, tone], i) => (
            <View key={l} style={{ minWidth: 120, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: i === 0 ? '#F7F8FA' : '#fff' }}>
              <Text style={{ fontSize: i === 0 ? 26 : 18, fontWeight: '800', color: tone }}>{v}</Text>
              <Muted>{l}</Muted>
            </View>
          ))}
        </Row>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10, marginTop: 4 }}>
          <WinGraphic
            pct={R.final * 100}
            manual={p.win_probability}
            trail={trail}
            pillars={PILLARS.map((q, i) => ({
              label: q.l,
              us: R.pil[q.k].x,
              rival: Math.max(0, ...map.comps.map((c) => c[q.k] / 10)),
              weight: R.w[i],
              state: q.k === 'product' ? 'scored' : map.pillars[q.k].state === 'absent' ? 'absent' : R.pil[q.k].state === 'scored' ? 'scored' : 'unknown',
            }))}
          />
        </View>
      </Card>

      <Segmented value={String(step)} onChange={(v) => setStep(Number(v))} options={STEPS.map((s, i) => ({ value: String(i), label: `${i + 1} ${s}` }))} />

      {step === 0 ? (
        <>
          <Section title="How the decision is made">
            <Card style={{ gap: 8 }}>
              <Select
                label="Decision type"
                value={map.type}
                options={Object.entries(DECISION_TYPES).map(([v, t]) => ({ value: v, label: t.l, hint: t.h }))}
                onChange={(v) => set({ type: v as DecisionType, w: [...DECISION_TYPES[v as DecisionType].w] })}
              />
              <Muted>{`Pillar weights: ${PILLARS.map((q, i) => `${q.l} ${Math.round(R.w[i] * 100)}%`).join(' · ')}${PEOPLE_PILLARS.some((q) => map.pillars[q.k].state === 'absent') ? ' (pillars not on this project give their weight to the others)' : ''}`}</Muted>
              <Grid min={160}>
                {PILLARS.map((q, i) => (
                  <Field
                    key={q.k}
                    label={`${q.l} %`}
                    keyboardType="number-pad"
                    value={String(map.w[i])}
                    onChangeText={(v) => {
                      const w = [...map.w] as WinMap['w'];
                      w[i] = Math.max(0, Number(v.replace(/\D/g, '')) || 0);
                      set({ w });
                    }}
                  />
                ))}
              </Grid>
            </Card>
          </Section>
          <Section title="Will the project go ahead?">
            <Card>
              <Grid min={200}>
                <Select label="Funding" value={map.funding} options={Object.entries(GO.funding).map(([v, o]) => ({ value: v, label: o.l }))} onChange={(v) => set({ funding: v as WinMap['funding'] })} />
                <Select label="Approvals" value={map.approvals} options={Object.entries(GO.approvals).map(([v, o]) => ({ value: v, label: o.l }))} onChange={(v) => set({ approvals: v as WinMap['approvals'] })} />
                <Select label="Project stage" value={map.stage} options={Object.entries(GO.stage).map(([v, o]) => ({ value: v, label: o.l }))} onChange={(v) => set({ stage: v as WinMap['stage'] })} />
              </Grid>
              <Muted>{`Go probability ${pct(R.go)}`}</Muted>
            </Card>
          </Section>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Notice>
            Map everyone who can affect the decision on our package. Add, rename or remove roles and sub-roles as this project needs; mark a pillar “not on this project” when it
            does not exist (with the reason) or “not yet known” while nobody is identified.
          </Notice>
          {PEOPLE_PILLARS.map((Q) => (
            <Section key={Q.k} title={Q.l}>
              <Card style={{ gap: 10 }}>
                {pillarHead(Q.k, Q.l)}
                {map.pillars[Q.k].state !== 'absent' ? map.people.filter((x) => x.pillar === Q.k).map(personCard) : null}
                {map.pillars[Q.k].state !== 'absent' ? (
                  <Row>
                    <Button small variant="secondary" title="+ Add a role" onPress={() => addPerson(Q.k)} />
                  </Row>
                ) : null}
              </Card>
            </Section>
          ))}
          {map.removed.length ? <Muted>{`Removed decision roles: ${map.removed.map((x) => `${x.role} – ${x.reason}`).join(' · ')}`}</Muted> : null}
        </>
      ) : null}

      {step === 2 ? (
        <Section title="Our product against the best competing product">
          <Card style={{ gap: 10 }}>
            {(
              [
                ['T', `Technical fit (weight ${pct(DECISION_TYPES[map.type].tr[0])})`],
                ['R', `Price (weight ${pct(DECISION_TYPES[map.type].tr[1])})`],
                ['M', `Commercial terms – lead time, stock, payment, warranty (weight ${pct(DECISION_TYPES[map.type].tr[2])})`],
              ] as const
            ).map(([k, l]) => (
              <View key={k} style={{ gap: 4 }}>
                <Text style={{ fontWeight: '600', color: colors.ink }}>{l}</Text>
                <Scale value={map.product[k]} onChange={(v) => set({ product: { ...map.product, [k]: v } })} />
              </View>
            ))}
            <Select
              label="How is our product specified?"
              value={map.product.lock}
              options={Object.entries(LOCK).map(([v, o]) => ({ value: v, label: o.l }))}
              onChange={(v) => set({ product: { ...map.product, lock: v as Lock } })}
              hint="“Or equal” and open specifications leave room for substitution at contractor stage."
            />
            <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 6 }}>Product-side teams</Text>
            <Muted>{"Our technical team, the manufacturer's support, competitors' local agents. A strong team lifts that side's product score by up to 15%."}</Muted>
            {map.product.team.map((t) => (
              <Row key={t.id} wrap gap={8} style={{ alignItems: 'flex-end' }}>
                <View style={{ minWidth: 200, flex: 1 }}>
                  <Field label="Role" value={t.role} onChangeText={(v) => set({ product: { ...map.product, team: map.product.team.map((y) => (y.id === t.id ? { ...y, role: v } : y)) } })} />
                </View>
                <View style={{ minWidth: 160 }}>
                  <Select
                    label="Side"
                    value={t.side}
                    options={[
                      { value: 'ours', label: 'Our side' },
                      { value: 'rival', label: 'Competitor side' },
                    ]}
                    onChange={(v) => set({ product: { ...map.product, team: map.product.team.map((y) => (y.id === t.id ? { ...y, side: v as 'ours' | 'rival' } : y)) } })}
                  />
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={{ fontWeight: '600', color: colors.ink }}>Strength</Text>
                  <Scale value={t.strength} onChange={(v) => set({ product: { ...map.product, team: map.product.team.map((y) => (y.id === t.id ? { ...y, strength: v } : y)) } })} />
                </View>
                <Button small variant="ghost" title="Remove" onPress={() => set({ product: { ...map.product, team: map.product.team.filter((y) => y.id !== t.id) } })} />
              </Row>
            ))}
            <Row>
              <Button
                small
                variant="secondary"
                title="+ Team member"
                onPress={() => set({ product: { ...map.product, team: [...map.product.team, { id: Math.max(0, ...map.product.team.map((y) => y.id)) + 1, role: '', side: 'ours', strength: 5 }] } })}
              />
            </Row>
            <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 6 }}>Deal-breakers</Text>
            <Toggle label="Our product fails a mandatory specification item" value={map.product.mand} onChange={(v) => set({ product: { ...map.product, mand: v } })} />
            <Toggle label="Our price is above the confirmed budget, with no approval to exceed it" value={map.product.budget} onChange={(v) => set({ product: { ...map.product, budget: v } })} />
          </Card>
        </Section>
      ) : null}

      {step === 3 ? (
        <>
          <Notice>{"Score each competitor's position in each pillar from 0 to 10. If you don't know, leave 6 – and assume they are working the people you can't reach."}</Notice>
          {map.comps.map((c, ci) => (
            <Section key={ci} title={`Competitor ${ci + 1}`} right={map.comps.length > 1 ? <Button small variant="ghost" title="Remove" onPress={() => set({ comps: map.comps.filter((_, j) => j !== ci) })} /> : undefined}>
              <Card style={{ gap: 8 }}>
                <Field label="Name / brand" value={c.name} onChangeText={(v) => set({ comps: map.comps.map((y, j) => (j === ci ? { ...y, name: v } : y)) })} />
                {PILLARS.filter((q) => q.k === 'product' || map.pillars[q.k as PeoplePillar].state !== 'absent').map((q) => (
                  <View key={q.k} style={{ gap: 4 }}>
                    <Text style={{ fontWeight: '600', color: colors.ink }}>{q.l}</Text>
                    <Scale value={c[q.k]} onChange={(v) => set({ comps: map.comps.map((y, j) => (j === ci ? { ...y, [q.k]: v } : y)) })} />
                  </View>
                ))}
              </Card>
            </Section>
          ))}
          {map.comps.length < 3 ? (
            <Row>
              <Button variant="secondary" title="+ Add a competitor" onPress={() => set({ comps: [...map.comps, { name: '', contractor: 6, consultant: 6, product: 6, client: 6 }] })} />
            </Row>
          ) : null}
        </>
      ) : null}

      {step === 4 ? (
        <Section title="Your gut feel">
          <Card style={{ gap: 8 }}>
            <Muted>Before you look at the result: what win probability would you give this deal?</Muted>
            <Row wrap gap={6}>
              {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => set({ gut: v })}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: map.gut === v ? colors.ink : colors.line, backgroundColor: map.gut === v ? colors.ink : '#fff' }}
                >
                  <Text style={{ color: map.gut === v ? '#fff' : colors.ink, fontWeight: '600' }}>{v}%</Text>
                </Pressable>
              ))}
            </Row>
          </Card>
        </Section>
      ) : null}

      {step === 5 ? (
        <>
          <Section title="Result">
            <Card style={{ gap: 6 }}>
              {R.capWhy.map((c) => (
                <Notice key={c} tone={colors.red}>
                  {c}
                </Notice>
              ))}
              {R.warnings.map((w) => (
                <Notice key={w} tone={colors.amber}>
                  {w}
                </Notice>
              ))}
              {Math.abs(map.gut - wiz) >= 20 ? (
                <Notice tone={colors.amber}>{`Your gut feel (${map.gut}%) is ${Math.abs(map.gut - wiz)} points ${map.gut > wiz ? 'higher' : 'lower'} than the wizard. ${map.gut > wiz ? 'Check for optimism, or add what you know to the map.' : 'You may have support the map does not show yet.'}`}</Notice>
              ) : (
                <Notice tone={colors.green}>{`Your gut feel (${map.gut}%) is close to the wizard.`}</Notice>
              )}
            </Card>
          </Section>
          <Section title="How the number is built">
            <Card style={{ gap: 4 }}>
              {[
                [`Our strength ${R.sUs.toFixed(2)} vs ${R.rivals.map((r) => `${r.name} ${r.s.toFixed(2)}`).join(', ')}`, ''],
                ['Head-to-head chance against all competitors', pct(R.share)],
                [`× Control factor (control ${pct(R.K)})`, `× ${R.cf.toFixed(2)}`],
                ['× Veto factor', `× ${R.V.toFixed(2)}`],
                ...(R.cap < 1 ? [['Cap applied', `max ${pct(R.cap)}`]] : []),
                ['= Get (we win if it goes ahead)', pct(R.get)],
                ['× Go (the project goes ahead)', `× ${pct(R.go)}`],
              ].map(([a, b]) => (
                <Row key={a} style={{ justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 6 }}>
                  <Text style={{ color: colors.text, flexShrink: 1 }}>{a}</Text>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{b}</Text>
                </Row>
              ))}
              <Row style={{ justifyContent: 'space-between', paddingTop: 8 }}>
                <Text style={{ fontWeight: '800', color: colors.ink, fontSize: 16 }}>Final win probability</Text>
                <Text style={{ fontWeight: '800', color: colors.ink, fontSize: 16 }}>{pct(R.final)}</Text>
              </Row>
            </Card>
          </Section>
          <Section title="Pillars">
            <Card style={{ gap: 4 }}>
              {PILLARS.map((q, i) => (
                <Row key={q.k} wrap style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600', color: colors.ink }}>{q.l}</Text>
                  <Muted>
                    {R.pil[q.k].state === 'absent'
                      ? 'not on this project'
                      : R.pil[q.k].state === 'unknown'
                        ? `not yet known (neutral) · weight ${pct(R.w[i])}`
                        : `score ${pct(R.pil[q.k].x)} · control ${pct(R.pil[q.k].c)} · weight ${pct(R.w[i])}`}
                  </Muted>
                </Row>
              ))}
            </Card>
          </Section>
          {R.actions.length ? (
            <Section title="What to do next">
              <Card style={{ gap: 4 }}>
                {R.actions.map((a, i) => (
                  <Text key={a} style={{ color: colors.text }}>{`${i + 1}. ${a}`}</Text>
                ))}
              </Card>
            </Section>
          ) : null}
          {canScore ? (
            <Section title="Use this result">
              <Card style={{ gap: 8 }}>
                <Muted>
                  {manager
                    ? 'Set the project’s win probability from this score, or only save the score.'
                    : 'Send the win probability to SM Projects for approval (as a change request), or only save the score. Both figures are kept for the trial comparison.'}
                </Muted>
                <Row wrap gap={8}>
                  <Button title={manager ? `Set ${wiz}% …` : `Send ${wiz}% for approval …`} onPress={() => saveScore(true)} />
                  <Button variant="secondary" title="Save score only" onPress={() => saveScore(false)} />
                </Row>
              </Card>
            </Section>
          ) : null}
          <Section title="Score history">
            <Card style={{ gap: 4 }}>
              {data.scores.map((s) => (
                <Muted key={s.id}>
                  {`${fmtDateTime(s.scored_at)} · ${people[s.scored_by]?.full_name ?? ''} · wizard ${s.wizard_pct}% · was ${s.manual_pct ?? '—'}%${s.chosen_pct != null ? ` · chosen ${s.chosen_pct}%` : ''} · ${s.applied === 'requested' ? 'sent to SM Projects' : s.applied === 'set' ? 'set' : 'saved'}`}
                </Muted>
              ))}
              {!data.scores.length ? <Muted>No scores yet.</Muted> : null}
            </Card>
          </Section>
        </>
      ) : null}

      <Row style={{ justifyContent: 'space-between', marginTop: 16 }}>
        {step > 0 ? <Button variant="secondary" title="Back" onPress={() => setStep(step - 1)} /> : <Button variant="ghost" title="Close" onPress={() => router.back()} />}
        {step < 5 ? <Button title={step === 4 ? 'See result' : 'Next'} onPress={() => setStep(step + 1)} /> : null}
      </Row>
      {data.savedAt ? <Muted style={{ marginTop: 8 }}>{`Map last saved ${fmtDateTime(data.savedAt)} – changes here are kept when you save a score.`}</Muted> : null}
    </Screen>
  );
}
