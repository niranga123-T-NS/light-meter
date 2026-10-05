import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { LocationPicker } from '@/components/LocationPicker';
import { mapEscape as esc, SalesMap } from '@/components/SalesMap';
import type { MapLine, MapPoint } from '@/components/SalesMap.types';
import { Button, Card, colors, DateField, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select, Stat, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { mn } from '@/lib/finance';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type MapVisit = {
  id: string;
  code: string;
  sales_person_id: string;
  person: string;
  checkin_at: string;
  checkout_at: string | null;
  lat: number | null;
  lng: number | null;
  gps_verified: boolean | null;
  distance_m: number | null;
  customer: string;
  project: string | null;
  project_id: string | null;
  objective: string;
  outcome: string | null;
  status: string;
  planned: boolean;
  plan_lat: number | null;
  plan_lng: number | null;
};
type Coverage = {
  kind: 'project' | 'customer';
  id: string;
  name: string;
  customer: string | null;
  owner_id: string | null;
  owner: string | null;
  lat: number | null;
  lng: number | null;
  loc_source: 'site' | 'visit' | null;
  last_visit: string | null;
  days_since: number | null;
  visits_90d: number;
  value_lkr: number | null;
  status: string;
};
type PlanLine = {
  id: string;
  plan_id: string;
  organization_id: string;
  plan_status: string;
  sales_person_id: string;
  person: string;
  planned_date: string;
  time_slot: string | null;
  status: 'planned' | 'completed' | 'rescheduled' | 'cancelled' | 'missed';
  customer: string;
  project: string | null;
  project_id: string | null;
  objective: string;
  category: string;
  lat: number | null;
  lng: number | null;
  loc_source: 'plan' | 'site' | 'customer' | 'visit' | null;
  visit_id: string | null;
  visit_lat: number | null;
  visit_lng: number | null;
  gps_verified: boolean | null;
  from_meeting: boolean;
  change_reason: string | null;
  missed_reason: string | null;
};
type View3 = 'visits' | 'planned' | 'coverage' | 'route' | 'heat';

const GREEN = '#16A34A';
const AMBER = '#D97706';
const RED = '#DC2626';
const GREY = '#6B7280';
const PERSON_COLOURS = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#65A30D', '#B91C1C', '#4F46E5', '#CA8A04'];

const has = <T extends { lat: number | null; lng: number | null }>(x: T): x is T & { lat: number; lng: number } => x.lat != null && x.lng != null;
const band = (d: number | null) => (d == null ? { colour: RED, label: 'Never visited' } : d <= 30 ? { colour: GREEN, label: '≤ 30 days' } : d <= 60 ? { colour: AMBER, label: '31 – 60 days' } : { colour: RED, label: 'Over 60 days' });
const BLUE = '#2563EB';
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`).getDay();
  return addDaysISO(iso, -((d + 6) % 7));
};
/** Planned visit colour: done, missed, due (blue), overdue but still open (amber), rescheduled / cancelled (grey). */
const planLook = (x: PlanLine, today: string) =>
  x.status === 'completed'
    ? { colour: GREEN, label: 'Done' }
    : x.status === 'missed'
      ? { colour: RED, label: 'Missed' }
      : x.status === 'planned'
        ? x.planned_date < today
          ? { colour: AMBER, label: 'Overdue – not checked in' }
          : { colour: BLUE, label: 'Planned' }
        : { colour: GREY, label: x.status === 'rescheduled' ? 'Rescheduled' : 'Cancelled' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Sales map (web app): where the team visits, which accounts are covered, a day's route, and where effort concentrates. */
export default function SalesMapScreen() {
  const me = useMe();
  const people = usePeople();
  const manager = me.role === 'gm' || me.role === 'sm_projects';
  const allowed = manager || isSales(me.role);
  const [view, setView] = useState<View3>('visits');
  const [from, setFrom] = useState(addDaysISO(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [day, setDay] = useState(todayISO());
  const [person, setPerson] = useState<string | null>(manager ? null : me.id);
  const [byPerson, setByPerson] = useState(false);
  const [show, setShow] = useState<'both' | 'project' | 'customer'>('both');
  const [heatProjects, setHeatProjects] = useState(false);
  const [pFrom, setPFrom] = useState(mondayOf(todayISO()));
  const [pTo, setPTo] = useState(addDaysISO(mondayOf(todayISO()), 5));
  // Setting a project site / customer location from the map
  const [picking, setPicking] = useState<{ kind: 'project' | 'customer'; id: string; name: string; query: string } | null>(null);

  const routePerson = manager ? person : me.id;
  const visits = useLoad(async () => {
    if (!allowed || view === 'coverage' || view === 'planned') return [] as MapVisit[];
    if (view === 'route') {
      if (!routePerson) return [] as MapVisit[];
      return rpc<MapVisit[]>('map_visits', { p_from: day, p_to: day, p_person: routePerson });
    }
    return rpc<MapVisit[]>('map_visits', { p_from: from, p_to: to, p_person: person });
  }, [view, from, to, day, person, allowed]);
  const plans = useLoad(async () => {
    if (!allowed || view !== 'planned') return [] as PlanLine[];
    return rpc<PlanLine[]>('map_plan_lines', { p_from: pFrom, p_to: pTo, p_person: person });
  }, [view, pFrom, pTo, person, allowed]);
  const coverage = useLoad(async () => {
    if (!allowed || (view !== 'coverage' && !(view === 'heat' && heatProjects))) return [] as Coverage[];
    return rpc<Coverage[]>('map_coverage', { p_person: person });
  }, [view, person, heatProjects, allowed]);

  const salesPeople = useMemo(
    () =>
      Object.values(people)
        .filter((p) => (p.role === 'asm_building' || p.role === 'asm_infra') && p.active !== false)
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [people],
  );
  const colourOf = useMemo(() => Object.fromEntries(salesPeople.map((p, i) => [p.id, PERSON_COLOURS[i % PERSON_COLOURS.length]])), [salesPeople]);

  const v = useMemo(() => visits.data ?? [], [visits.data]);
  const c = useMemo(() => coverage.data ?? [], [coverage.data]);
  const pl = useMemo(() => plans.data ?? [], [plans.data]);
  const today = todayISO();
  const fitKey = `${view}|${from}|${to}|${day}|${person}|${show}|${pFrom}|${pTo}`;

  const map = useMemo((): { points: MapPoint[]; lines: MapLine[]; heat?: [number, number, number][] } => {
    const visitLabel = (x: MapVisit) =>
      `<b>${esc(x.customer)}</b>${x.project ? `<br/>${esc(x.project)}` : ''}<br/>${esc(x.person)} · ${esc(fmtDateTime(x.checkin_at))}<br/>${esc(x.objective)}${x.outcome ? ` · ${esc(x.outcome)}` : ''}<br/>${
        x.gps_verified ? 'GPS verified' : x.distance_m != null ? `${Math.round(x.distance_m)} m from the site` : 'Not checked against a site'
      }${x.planned ? ' · planned' : ' · unplanned'}`;
    if (view === 'visits') {
      return {
        lines: [],
        points: v.filter(has).map((x) => ({
          lat: x.lat,
          lng: x.lng,
          color: byPerson ? (colourOf[x.sales_person_id] ?? GREY) : x.gps_verified ? GREEN : x.gps_verified === false ? AMBER : GREY,
          hollow: !x.planned,
          label: visitLabel(x),
          href: `/visits/${x.id}`,
        })),
      };
    }
    if (view === 'planned') {
      const pts: MapPoint[] = [];
      const lines: MapLine[] = [];
      for (const x of pl.filter(has)) {
        const look = planLook(x, today);
        pts.push({
          lat: x.lat,
          lng: x.lng,
          color: byPerson ? (colourOf[x.sales_person_id] ?? GREY) : look.colour,
          hollow: x.status === 'rescheduled' || x.status === 'cancelled',
          dashed: x.status === 'cancelled',
          label: `<b>${esc(x.customer)}</b>${x.project ? `<br/>${esc(x.project)}` : ''}<br/>${esc(x.person)} · ${esc(fmtDate(x.planned_date))}${x.time_slot ? ` ${esc(x.time_slot)}` : ''}<br/>${esc(x.objective)}<br/><b>${look.label}</b>${
            x.missed_reason ? ` – ${esc(x.missed_reason)}` : x.change_reason && x.status !== 'planned' ? ` – ${esc(x.change_reason)}` : ''
          }${x.from_meeting ? '<br/>Follow-up from the sales meeting' : ''}${x.plan_status !== 'approved' ? `<br/><i>Plan ${esc(x.plan_status)}</i>` : ''}${
            x.loc_source === 'visit' ? '<br/><i>Position from the customer’s last visit</i>' : x.loc_source === 'customer' ? '<br/><i>Customer location</i>' : ''
          }`,
          href: x.visit_id ? `/visits/${x.visit_id}` : `/plan/${x.plan_id}`,
        });
        // Done: planned position → where they actually checked in
        if (x.visit_lat != null && x.visit_lng != null && (Math.abs(x.visit_lat - x.lat) > 0.0005 || Math.abs(x.visit_lng - x.lng) > 0.0005)) {
          lines.push({ coords: [[x.lat, x.lng], [x.visit_lat, x.visit_lng]], color: GREY, weight: 2, dashed: true });
          pts.push({ lat: x.visit_lat, lng: x.visit_lng, color: x.gps_verified ? GREEN : AMBER, radius: 4, label: `<b>Actual check-in</b><br/>${esc(x.customer)}`, href: `/visits/${x.visit_id}` });
        }
      }
      return { points: pts, lines };
    }
    if (view === 'route') {
      const stops = v.filter(has);
      const pts: MapPoint[] = stops.map((x, i) => ({ lat: x.lat, lng: x.lng, color: x.gps_verified ? GREEN : AMBER, number: i + 1, label: visitLabel(x), href: `/visits/${x.id}` }));
      const lines: MapLine[] = [{ coords: stops.map((x) => [x.lat, x.lng] as [number, number]), color: '#2563EB', weight: 4 }];
      // Planned site vs actual check-in
      for (const x of stops) {
        if (x.plan_lat != null && x.plan_lng != null) {
          pts.push({ lat: x.plan_lat, lng: x.plan_lng, color: GREY, hollow: true, dashed: true, radius: 6, label: `<b>Planned location</b><br/>${esc(x.customer)}` });
          lines.push({ coords: [[x.plan_lat, x.plan_lng], [x.lat, x.lng]], color: GREY, weight: 2, dashed: true });
        }
      }
      return { points: pts, lines };
    }
    if (view === 'heat') {
      return {
        lines: [],
        heat: v.filter(has).map((x) => [x.lat, x.lng, 1] as [number, number, number]),
        points: heatProjects
          ? c
              .filter((x) => x.kind === 'project')
              .filter(has)
              .map((x) => ({ lat: x.lat, lng: x.lng, color: band(x.days_since).colour, radius: 4, label: `<b>${esc(x.name)}</b><br/>${band(x.days_since).label}` }))
          : [],
      };
    }
    // coverage
    const maxV = Math.max(1, ...c.map((x) => x.value_lkr ?? 0));
    return {
      lines: [],
      points: c
        .filter((x) => show === 'both' || x.kind === show)
        .filter(has)
        .map((x) => {
          const b = band(x.days_since);
          return {
            lat: x.lat,
            lng: x.lng,
            color: b.colour,
            hollow: x.kind === 'customer',
            radius: x.kind === 'project' ? 6 + 10 * Math.sqrt((x.value_lkr ?? 0) / maxV) : 7,
            label: `<b>${esc(x.name)}</b>${x.customer ? `<br/>${esc(x.customer)}` : ''}<br/>${x.kind === 'project' ? 'Project' : 'Customer'} · ${esc(x.owner ?? 'no owner')}<br/>Last visit: ${
              x.last_visit ? `${esc(fmtDate(x.last_visit))} (${x.days_since} days)` : 'never'
            } · ${x.visits_90d} in 90 days${x.value_lkr ? `<br/>Lighting value ${mn(x.value_lkr)} Mn` : ''}${x.loc_source === 'visit' ? '<br/><i>Position from a visit check-in</i>' : ''}`,
            href: x.kind === 'project' ? `/projects/${x.id}` : `/customers/${x.id}`,
          };
        }),
    };
  }, [view, v, c, pl, today, byPerson, colourOf, show, heatProjects]);

  if (Platform.OS !== 'web')
    return (
      <Screen>
        <Notice>The map is available in the web app – open dimo-lighting-ops.vercel.app in a browser.</Notice>
      </Screen>
    );
  if (!allowed)
    return (
      <Screen>
        <Notice>The sales map is for GM / DGM, SM Projects and the sales team.</Notice>
      </Screen>
    );

  const located = v.filter(has);
  const verified = located.filter((x) => x.gps_verified).length;
  const covered = c.filter((x) => show === 'both' || x.kind === show);
  const bands = { g: 0, a: 0, r: 0, n: 0, none: 0 };
  for (const x of covered) {
    if (!has(x)) bands.none++;
    else if (x.days_since == null) bands.n++;
    else if (x.days_since <= 30) bands.g++;
    else if (x.days_since <= 60) bands.a++;
    else bands.r++;
  }
  const neglected = covered
    .filter((x) => x.kind === 'project' && (x.days_since == null || x.days_since > 60))
    .sort((a, b) => (b.value_lkr ?? 0) - (a.value_lkr ?? 0))
    .slice(0, 15);
  const src = view === 'coverage' ? coverage : view === 'planned' ? plans : visits;
  // Planned visits / accounts with no position, one row per project (or customer when there is no project)
  const unplaced = [
    ...new Map(
      pl
        .filter((x) => !has(x))
        .map((x) => [
          x.project_id ?? x.organization_id,
          { key: x.project_id ?? x.organization_id, project_id: x.project_id, project: x.project, organization_id: x.organization_id, customer: x.customer, n: pl.filter((y) => !has(y) && (y.project_id ?? y.organization_id) === (x.project_id ?? x.organization_id)).length },
        ]),
    ).values(),
  ];
  const noLocation = c.filter((x) => !has(x) && (show === 'both' || x.kind === show));
  const setLocation = (pick: { kind: 'project' | 'customer'; id: string; name: string; query: string }) => setPicking(pick);
  const loading = src.loading;
  const error = src.error;
  const pc = { planned: 0, done: 0, missed: 0, overdue: 0, moved: 0, none: 0 };
  for (const x of pl) {
    if (!has(x)) pc.none++;
    if (x.status === 'completed') pc.done++;
    else if (x.status === 'missed') pc.missed++;
    else if (x.status === 'planned') {
      if (x.planned_date < today) pc.overdue++;
      else pc.planned++;
    } else pc.moved++;
  }
  const due = pc.done + pc.missed + pc.overdue;

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: 'Sales map' }} />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'visits', label: 'Visits' },
          { value: 'planned', label: 'Planned' },
          { value: 'coverage', label: 'Coverage' },
          { value: 'route', label: 'Day route' },
          { value: 'heat', label: 'Heat map' },
        ]}
      />
      <Card>
        <Row wrap gap={12} style={{ alignItems: 'flex-end' }}>
          {manager ? (
            <View style={{ minWidth: 220, flex: 1 }}>
              <Select
                label={view === 'route' ? 'Sales person (choose one)' : 'Sales person'}
                value={person ?? 'all'}
                onChange={(x) => setPerson(x === 'all' ? null : x)}
                options={[...(view === 'route' ? [] : [{ value: 'all', label: 'Whole team' }]), ...salesPeople.map((p) => ({ value: p.id, label: p.full_name }))]}
                searchable
              />
            </View>
          ) : null}
          {view === 'visits' || view === 'heat' ? (
            <>
              <View style={{ minWidth: 170 }}>
                <DateField label="From" value={from} onChange={(x) => x && setFrom(x)} quick={[]} />
              </View>
              <View style={{ minWidth: 170 }}>
                <DateField label="To" value={to} onChange={(x) => x && setTo(x)} quick={[0]} />
              </View>
            </>
          ) : null}
          {view === 'planned' ? (
            <>
              <View style={{ minWidth: 170 }}>
                <DateField label="From" value={pFrom} onChange={(x) => x && setPFrom(x)} quick={[]} />
              </View>
              <View style={{ minWidth: 170 }}>
                <DateField label="To" value={pTo} onChange={(x) => x && setPTo(x)} quick={[]} />
              </View>
              <Row gap={6} style={{ marginBottom: 8 }}>
                {[
                  ['This week', 0],
                  ['Next week', 7],
                  ['Last week', -7],
                ].map(([label, shift]) => (
                  <Button
                    key={label as string}
                    small
                    title={label as string}
                    variant={pFrom === addDaysISO(mondayOf(todayISO()), shift as number) ? 'primary' : 'secondary'}
                    onPress={() => {
                      const m = addDaysISO(mondayOf(todayISO()), shift as number);
                      setPFrom(m);
                      setPTo(addDaysISO(m, 5));
                    }}
                  />
                ))}
              </Row>
            </>
          ) : null}
          {view === 'route' ? (
            <View style={{ minWidth: 170 }}>
              <DateField label="Day" value={day} onChange={(x) => x && setDay(x)} quick={[0]} />
            </View>
          ) : null}
          {view === 'coverage' ? (
            <View style={{ minWidth: 260 }}>
              <Segmented
                value={show}
                onChange={setShow}
                options={[
                  { value: 'both', label: 'All' },
                  { value: 'project', label: 'Projects' },
                  { value: 'customer', label: 'Customers' },
                ]}
              />
            </View>
          ) : null}
          {(view === 'visits' || view === 'planned') && manager && !person ? <Toggle label="Colour by sales person" value={byPerson} onChange={setByPerson} /> : null}
          {view === 'heat' ? <Toggle label="Show projects (coverage colours)" value={heatProjects} onChange={setHeatProjects} /> : null}
        </Row>
      </Card>

      <ErrorBanner message={error} />

      {view === 'visits' || view === 'heat' ? (
        <Grid min={170}>
          <Stat label="Visits" value={v.length} />
          <Stat label="On the map" value={located.length} />
          <Stat label="GPS verified" value={located.length ? `${Math.round((verified / located.length) * 100)}%` : '—'} tone={located.length && verified / located.length < 0.7 ? 'amber' : undefined} />
          <Stat label="Unplanned" value={v.filter((x) => !x.planned).length} />
          <Stat label="No location" value={v.length - located.length} tone={v.length - located.length ? 'amber' : undefined} />
        </Grid>
      ) : null}
      {view === 'planned' ? (
        <Grid min={150}>
          <Stat label="Planned visits" value={pl.length} />
          <Stat label="Done" value={pc.done} tone="green" />
          <Stat label="Missed" value={pc.missed} tone={pc.missed ? 'red' : undefined} />
          <Stat label="Overdue – not checked in" value={pc.overdue} tone={pc.overdue ? 'amber' : undefined} />
          <Stat label="Still to come" value={pc.planned} />
          <Stat label="Done of those due" value={due ? `${Math.round((pc.done / due) * 100)}%` : '—'} tone={due && pc.done / due < 0.8 ? 'amber' : undefined} />
          <Stat label="Rescheduled / cancelled" value={pc.moved} />
          <Stat label="No location" value={pc.none} />
        </Grid>
      ) : null}
      {view === 'coverage' ? (
        <Grid min={160}>
          <Stat label="Visited ≤ 30 days" value={bands.g} tone="green" />
          <Stat label="31 – 60 days" value={bands.a} tone={bands.a ? 'amber' : undefined} />
          <Stat label="Over 60 days" value={bands.r} tone={bands.r ? 'red' : undefined} />
          <Stat label="Never visited" value={bands.n} tone={bands.n ? 'red' : undefined} />
          <Stat label="No location yet" value={bands.none} />
        </Grid>
      ) : null}
      {view === 'route' && !routePerson ? <Notice>Choose a sales person to see their route.</Notice> : null}

      <Card style={{ padding: 6 }}>
        {loading && !map.points.length ? (
          <Loading />
        ) : (
          <SalesMap points={map.points} lines={map.lines} heat={map.heat} fitKey={fitKey} onOpen={(href) => router.push(href as never)} height={600} />
        )}
        <Row wrap gap={10} style={{ marginTop: 8, paddingHorizontal: 6 }}>
          {view === 'visits' && !byPerson ? (
            <>
              <Pill label="GPS verified" tone={GREEN} />
              <Pill label="Away from the site" tone={AMBER} />
              <Pill label="No site to check" tone={GREY} />
              <Muted>Hollow = unplanned visit</Muted>
            </>
          ) : null}
          {view === 'planned' && !byPerson ? (
            <>
              <Pill label="Done" tone={GREEN} />
              <Pill label="Planned" tone={BLUE} />
              <Pill label="Overdue – not checked in" tone={AMBER} />
              <Pill label="Missed" tone={RED} />
              <Pill label="Rescheduled / cancelled (hollow)" tone={GREY} />
              <Muted>Grey dashed line = planned position → actual check-in</Muted>
            </>
          ) : null}
          {(view === 'visits' || view === 'planned') && byPerson ? salesPeople.map((p) => <Pill key={p.id} label={p.full_name} tone={colourOf[p.id]} />) : null}
          {view === 'coverage' || (view === 'heat' && heatProjects) ? (
            <>
              <Pill label="Visited ≤ 30 days" tone={GREEN} />
              <Pill label="31 – 60 days" tone={AMBER} />
              <Pill label="Over 60 days / never" tone={RED} />
              {view === 'coverage' ? <Muted>Filled = project (bigger = higher lighting value) · hollow = customer</Muted> : null}
            </>
          ) : null}
          {view === 'route' ? <Muted>Numbers = check-in order · grey dashed = planned location → actual check-in</Muted> : null}
          {view === 'heat' ? <Muted>Brighter = more visits in the period</Muted> : null}
        </Row>
        <Muted style={{ paddingHorizontal: 6, marginTop: 4 }}>Shows recorded check-in points only – no live tracking.</Muted>
      </Card>

      {view === 'planned' && unplaced.length ? (
        <Section title={`Not on the map – no location yet (${pc.none} planned visits)`}>
          <Notice tone={colors.amber}>
            {
              "A planned visit is placed from the project's site, else the customer's location, else the customer's last GPS visit. These have none yet – set the location once and every future visit to them shows on the map."
            }
          </Notice>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {unplaced.map((x) => (
              <ListRow
                key={x.key}
                wrapRight
                title={x.project ? `${x.project} · ${x.customer}` : x.customer}
                subtitle={`${x.n} planned visit${x.n === 1 ? '' : 's'} in these dates`}
                right={
                  <Row gap={6} wrap>
                    {x.project_id ? (
                      <Button small title="Set project site" onPress={() => setLocation({ kind: 'project', id: x.project_id as string, name: x.project ?? '', query: `${x.project ?? ''} ${x.customer}` })} />
                    ) : null}
                    <Button
                      small
                      variant={x.project_id ? 'secondary' : 'primary'}
                      title="Set customer location"
                      onPress={() => setLocation({ kind: 'customer', id: x.organization_id, name: x.customer, query: x.customer })}
                    />
                  </Row>
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {view === 'planned' && pl.length ? (
        <Section title={`Planned visits ${fmtDate(pFrom)} – ${fmtDate(pTo)}`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pl.map((x) => {
              const look = planLook(x, today);
              return (
                <ListRow
                  key={x.id}
                  title={`${new Date(`${x.planned_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} ${fmtDate(x.planned_date)}${x.time_slot ? ` ${x.time_slot}` : ''} · ${x.customer}`}
                  subtitle={`${manager ? `${x.person} · ` : ''}${x.project ? `${x.project} · ` : ''}${x.objective}${x.from_meeting ? ' · sales meeting follow-up' : ''}${x.lat == null ? ' · no location' : ''}`}
                  right={<Pill label={look.label} tone={look.colour} />}
                  onPress={() => router.push(x.visit_id ? `/visits/${x.visit_id}` : `/plan/${x.plan_id}`)}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {view === 'coverage' && noLocation.length ? (
        <Section title={`No location yet (${noLocation.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {noLocation.slice(0, 40).map((x) => (
              <ListRow
                key={`${x.kind}-${x.id}`}
                wrapRight
                title={x.name}
                subtitle={`${x.kind === 'project' ? `Project · ${x.customer ?? ''}` : 'Customer'} · ${x.owner ?? 'no owner'}`}
                right={
                  <Button
                    small
                    title={x.kind === 'project' ? 'Set project site' : 'Set customer location'}
                    onPress={() => setLocation({ kind: x.kind, id: x.id, name: x.name, query: x.kind === 'project' ? `${x.name} ${x.customer ?? ''}` : x.name })}
                  />
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {view === 'route' && routePerson ? (
        <Section title={`${people[routePerson]?.full_name ?? ''} · ${fmtDate(day)} · ${v.length} visits`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {v.length ? (
              v.map((x, i) => (
                <ListRow
                  key={x.id}
                  title={`${i + 1}. ${time(x.checkin_at)}${x.checkout_at ? ` – ${time(x.checkout_at)}` : ''} · ${x.customer}`}
                  subtitle={`${x.project ? `${x.project} · ` : ''}${x.objective}${x.outcome ? ` · ${x.outcome}` : ''}${x.lat == null ? ' · no location' : ''}`}
                  right={<Pill label={x.gps_verified ? 'GPS verified' : x.planned ? 'Planned' : 'Unplanned'} tone={x.gps_verified ? GREEN : x.planned ? AMBER : GREY} />}
                  onPress={() => router.push(`/visits/${x.id}`)}
                />
              ))
            ) : (
              <View style={{ padding: 14 }}>
                <Muted>No visits recorded that day.</Muted>
              </View>
            )}
          </Card>
        </Section>
      ) : null}

      {view === 'coverage' && neglected.length ? (
        <Section title="Projects not visited for 60+ days – highest value first">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {neglected.map((x) => (
              <ListRow
                key={x.id}
                title={x.name}
                subtitle={`${x.customer ?? ''} · ${x.owner ?? 'no owner'} · ${x.last_visit ? `last visit ${fmtDate(x.last_visit)} (${x.days_since} days)` : 'never visited'}${has(x) ? '' : ' · no location'}`}
                right={<Text style={{ fontWeight: '700', color: colors.ink }}>{x.value_lkr ? `${mn(x.value_lkr)} Mn` : '—'}</Text>}
                onPress={() => router.push(`/projects/${x.id}`)}
              />
            ))}
          </Card>
        </Section>
      ) : null}
      <LocationPicker
        key={picking ? `${picking.kind}-${picking.id}` : 'none'}
        visible={!!picking}
        title={picking ? `${picking.kind === 'project' ? 'Project site' : 'Customer location'} – ${picking.name}` : ''}
        query={picking?.query.trim() ?? ''}
        onClose={() => setPicking(null)}
        onSave={async (pt) => {
          if (!picking) return;
          try {
            await rpc('set_map_location', { p_kind: picking.kind, p_id: picking.id, p_lat: pt.lat, p_lng: pt.lng });
            setPicking(null);
            await Promise.all([plans.reload(), coverage.reload()]);
          } catch (e) {
            window.alert(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </Screen>
  );
}
