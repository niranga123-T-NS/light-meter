import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, Card, colors, KeyValue, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { mapLink, siteFix } from '@/lib/site';
import { rpc, supabase } from '@/lib/supabase';

export type ClaimSite = { id: string; assignee_id: string | null; site_lat?: number | null; site_lng?: number | null; site_radius_m?: number | null; visit_on?: string | null; status: string; inspected_on: string | null };
type Checkin = { id: string; user_id: string; at: string; day: string; distance_m: number; within: boolean };

const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Where the engineer inspects the claim: the SEE picks the point on the map; the engineer checks in there (location verified). */
export function ClaimSiteCard({ c, query, onChange }: { c: ClaimSite; query: string; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const [picking, setPicking] = useState(false);
  const can = me.role === 'senior_elec_engineer' || me.role === 'operations_exec';
  const engineer = c.assignee_id === me.id;
  const { data: checkins, reload } = useLoad(async () => {
    const { data } = await supabase.from('claim_checkins').select('id, user_id, at, day, distance_m, within').eq('claim_id', c.id).order('at', { ascending: false }).limit(20);
    return (data ?? []) as Checkin[];
  }, [c.id]);
  const has = c.site_lat != null && c.site_lng != null;
  const today = todayISO();
  const okToday = (checkins ?? []).find((k) => k.within && k.day === today && k.user_id === c.assignee_id);
  const last = (checkins ?? [])[0];

  const checkin = async () => {
    const fix = await siteFix();
    if (!fix) return dialog.toast('Location could not be read – allow location access and try again', 'error');
    await dialog.run(async () => {
      const r = await rpc<{ within: boolean; distance_m: number; radius_m: number }>('claim_checkin', { p_id: c.id, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy });
      await reload();
      if (!r.within) throw new Error(`You are ${dist(r.distance_m)} from the site (check-in within ${r.radius_m} m) – check in at the site`);
    }, 'Checked in at the site – the Senior Electrical Engineer is told');
  };
  const enter = async () => {
    const r = await dialog.prompt({
      title: 'Site location',
      message: 'Paste the coordinates from Google Maps (long-press the spot → copy "6.9271, 79.8612").',
      fields: [
        { key: 'c', label: 'Latitude, longitude', required: true, initial: has ? `${c.site_lat}, ${c.site_lng}` : '' },
        { key: 'r', label: 'Check-in radius (m)', required: true, initial: String(c.site_radius_m ?? 300) },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const [lat, lng] = r.c.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return dialog.toast('Enter the latitude and longitude, e.g. 6.9271, 79.8612', 'error');
    await dialog.run(async () => {
      await rpc('set_claim_site', { p_id: c.id, p_lat: lat, p_lng: lng, p_radius: Number(r.r) || 300 });
      onChange();
    }, 'Site location saved');
  };

  return (
    <Section title="Site visit">
      <Card>
        {has ? (
          <>
            <KeyValue label="Site location" value={`${c.site_lat!.toFixed(5)}, ${c.site_lng!.toFixed(5)} · check-in within ${c.site_radius_m ?? 300} m`} />
            {c.visit_on ? <KeyValue label="Visit" value={fmtDate(c.visit_on)} /> : null}
          </>
        ) : (
          <Notice tone={colors.amber}>{can ? 'Set the site location – the engineer checks in there before recording the inspection.' : 'The site location is not set yet – the Senior Electrical Engineer sets it.'}</Notice>
        )}
        {last ? (
          <Row wrap gap={6} style={{ marginTop: 4, alignItems: 'center' }}>
            <Pill label={last.within ? `Checked in ${fmtDateTime(last.at)}` : `Away from site · ${fmtDateTime(last.at)}`} tone={last.within ? colors.green : colors.red} />
            <Muted>{`${dist(last.distance_m)} from the site`}</Muted>
          </Row>
        ) : null}
        <Row wrap gap={6} style={{ marginTop: 6 }}>
          {engineer && has && c.status === 'open' && !c.inspected_on && !okToday ? <Button small title="📍 Check in at the site" onPress={checkin} /> : null}
          {has ? <Button small variant="ghost" title="Open in Maps" onPress={() => Linking.openURL(mapLink(c.site_lat!, c.site_lng!))} /> : null}
          {can && c.status === 'open' && Platform.OS === 'web' ? <Button small variant="secondary" title={has ? 'Change on map' : 'Pick on the map'} onPress={() => setPicking(true)} /> : null}
          {can && c.status === 'open' ? <Button small variant="ghost" title="Enter coordinates" onPress={enter} /> : null}
        </Row>
        {engineer && has && !c.inspected_on && !okToday ? <Muted>Check in at the site first – the inspection is recorded after your location is verified.</Muted> : null}
      </Card>
      <LocationPicker
        visible={picking}
        title="Warranty site – pick the point the engineer checks in at"
        query={query}
        initial={has ? { lat: c.site_lat!, lng: c.site_lng! } : null}
        onClose={() => setPicking(false)}
        onSave={async (p) => {
          await dialog.run(async () => {
            await rpc('set_claim_site', { p_id: c.id, p_lat: p.lat, p_lng: p.lng });
            setPicking(false);
            onChange();
          }, 'Site location saved');
        }}
      />
    </Section>
  );
}
