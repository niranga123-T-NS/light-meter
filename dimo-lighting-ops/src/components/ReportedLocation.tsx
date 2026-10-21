import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, KeyValue, Muted, Row } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { mapLink } from '@/lib/site';
import { rpc, supabase } from '@/lib/supabase';

export type RepFrom = 'gps' | 'map' | 'project';
export type RepLoc = { lat: number; lng: number; from: RepFrom } | null;
export const REP_FROM: Record<RepFrom, string> = { gps: 'GPS at the site', map: 'pinned on the map', project: 'the project location' };
export const repText = (lat: number, lng: number, from?: string | null) => `${lat.toFixed(5)}, ${lng.toFixed(5)}${from && from in REP_FROM ? ` – ${REP_FROM[from as RepFrom]}` : ''}`;

/** Share the site location when raising a warranty issue, a claim or a defect: GPS at the site, a pin on the map, or the project location. */
export function ReportedLocationField({ value, onChange, query, projectId }: { value: RepLoc; onChange: (v: RepLoc) => void; query: string; projectId?: string | null }) {
  const dialog = useDialog();
  const [map, setMap] = useState(false);
  const here = () =>
    dialog.run(async () => {
      const pos = await captureLocation();
      if (!pos) throw new Error('Allow location access to share where you are');
      onChange({ lat: pos.lat, lng: pos.lng, from: 'gps' });
    }, 'Location taken – share it only if you are at the site');
  const fromProject = () =>
    dialog.run(async () => {
      const { data } = await supabase.from('projects').select('lat, lng').eq('id', projectId as string).maybeSingle();
      if (data?.lat == null || data?.lng == null) throw new Error('The project has no location in the system – use your location at the site or pin it on the map');
      onChange({ lat: data.lat, lng: data.lng, from: 'project' });
    }, 'The project location is used');
  return (
    <>
      <Muted>Site location for the engineer – share it so they can find the site (the SEE checks it when assigning).</Muted>
      <Row wrap gap={6}>
        <Button small variant="secondary" title="Use my location (I am at the site)" onPress={here} />
        {Platform.OS === 'web' ? <Button small variant="secondary" title="Pin on the map" onPress={() => setMap(true)} /> : null}
        {projectId ? <Button small variant="secondary" title="Use the project location" onPress={fromProject} /> : null}
        {value ? <Button small variant="ghost" title="Open in Maps" onPress={() => Linking.openURL(mapLink(value.lat, value.lng))} /> : null}
        {value ? <Button small variant="ghost" title="Clear" onPress={() => onChange(null)} /> : null}
      </Row>
      <Muted>{value ? `Shared: ${repText(value.lat, value.lng, value.from)}` : 'Not shared yet.'}</Muted>
      <LocationPicker
        visible={map}
        title="Site location"
        query={query}
        initial={value ? { lat: value.lat, lng: value.lng } : null}
        onSave={async (p) => {
          onChange({ lat: p.lat, lng: p.lng, from: 'map' });
          setMap(false);
        }}
        onClose={() => setMap(false)}
      />
    </>
  );
}

/** Store the shared location on the record just raised. */
export const saveReportedLocation = (kind: 'warranty_report' | 'warranty_claim' | 'project_defect', id: string, v: RepLoc) =>
  v ? rpc('set_reported_location', { p_kind: kind, p_id: id, p_lat: v.lat, p_lng: v.lng, p_from: v.from }) : Promise.resolve();

/** The location shared by the reporter, with Open in Maps. */
export function ReportedLocationRow({ lat, lng, from, by, label = 'Location shared' }: { lat: number | null; lng: number | null; from?: string | null; by?: string; label?: string }) {
  if (lat == null || lng == null) return <KeyValue label={label} value="Not shared – ask the reporter, or find the site from the address" />;
  return (
    <>
      <KeyValue label={label} value={`${repText(lat, lng, from)}${by ? ` · by ${by}` : ''}`} />
      <Row>
        <Button small variant="ghost" title="Open in Maps" onPress={() => Linking.openURL(mapLink(lat, lng))} />
      </Row>
    </>
  );
}
