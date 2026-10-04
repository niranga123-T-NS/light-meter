import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { mapEscape as esc, SalesMap } from '@/components/SalesMap';
import type { MapLine, MapPoint } from '@/components/SalesMap.types';
import { Card, colors, DateField, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select, Stat, Toggle } from '@/components/ui';
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
type View3 = 'visits' | 'coverage' | 'route' | 'heat';

const GREEN = '#16A34A';
const AMBER = '#D97706';
const RED = '#DC2626';
const GREY = '#6B7280';
const PERSON_COLOURS = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#65A30D', '#B91C1C', '#4F46E5', '#CA8A04'];

const has = <T extends { lat: number | null; lng: number | null }>(x: T): x is T & { lat: number; lng: number } => x.lat != null && x.lng != null;
const band = (d: number | null) => (d == null ? { colour: RED, label: 'Never visited' } : d <= 30 ? { colour: GREEN, label: '≤ 30 days' } : d <= 60 ? { colour: AMBER, label: '31 – 60 days' } : { colour: RED, label: 'Over 60 days' });
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

  const routePerson = manager ? person : me.id;
  const visits = useLoad(async () => {
    if (!allowed || view === 'coverage') return [] as MapVisit[];
    if (view === 'route') {
      if (!routePerson) return [] as MapVisit[];
      return rpc<MapVisit[]>('map_visits', { p_from: day, p_to: day, p_person: routePerson });
    }
    return rpc<MapVisit[]>('map_visits', { p_from: from, p_to: to, p_person: person });
  }, [view, from, to, day, person, allowed]);
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
  const fitKey = `${view}|${from}|${to}|${day}|${person}|${show}`;

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
  }, [view, v, c, byPerson, colourOf, show, heatProjects]);

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
  const loading = (view === 'coverage' ? coverage : visits).loading;
  const error = (view === 'coverage' ? coverage : visits).error;

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: 'Sales map' }} />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'visits', label: 'Visits' },
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
          {view === 'visits' && manager && !person ? <Toggle label="Colour by sales person" value={byPerson} onChange={setByPerson} /> : null}
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
          {view === 'visits' && byPerson ? salesPeople.map((p) => <Pill key={p.id} label={p.full_name} tone={colourOf[p.id]} />) : null}
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
    </Screen>
  );
}
