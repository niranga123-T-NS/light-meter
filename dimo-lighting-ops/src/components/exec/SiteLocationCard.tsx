import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { LocationPicker } from '@/components/LocationPicker';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, KeyValue, Muted, Notice, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDateTimeY } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { mapLink, siteFix } from '@/lib/site';
import { rpc } from '@/lib/supabase';

/** The site's GPS location – set by the SEE when opening the project; supervisors' check-ins are verified against it. */
export function SiteLocationCard({ p, onChange }: { p: ExecProject; onChange?: () => void }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [picking, setPicking] = useState(false);
  const can = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const save = (lat: number, lng: number, radius: number) =>
    dialog.run(async () => {
      await rpc('set_site_location', { p_exec: p.id, p_lat: lat, p_lng: lng, p_radius: radius });
      onChange?.();
    }, 'Site location saved');
  const here = async () => {
    const fix = await siteFix();
    if (!fix) return dialog.toast('Location could not be read – allow location access in the browser / phone settings', 'error');
    const ok = await dialog.confirm('Use this location as the site?', `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}${fix.accuracy ? ` (±${Math.round(fix.accuracy)} m)` : ''} – stand at the site office / main gate when you do this.`);
    if (ok) await save(fix.lat, fix.lng, p.site_radius_m ?? 300);
  };
  const enter = async () => {
    const r = await dialog.prompt({
      title: 'Site location',
      message: 'Paste the coordinates from Google Maps (long-press the site → copy "6.9271, 79.8612").',
      fields: [
        { key: 'c', label: 'Latitude, longitude', required: true, initial: p.site_lat != null ? `${p.site_lat}, ${p.site_lng}` : '' },
        { key: 'r', label: 'Check-in radius (m)', required: true, initial: String(p.site_radius_m ?? 300) },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const [lat, lng] = r.c.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return dialog.toast('Enter the latitude and longitude, e.g. 6.9271, 79.8612', 'error');
    await save(lat, lng, Number(r.r) || 300);
  };
  return (
    <Section title="Site location">
      <Card>
        {p.site_lat != null && p.site_lng != null ? (
          <>
            <KeyValue label="GPS" value={`${p.site_lat.toFixed(6)}, ${p.site_lng.toFixed(6)} · check-in within ${p.site_radius_m ?? 300} m`} />
            {p.site_set_at ? <Muted>{`Set by ${people[p.site_set_by ?? '']?.full_name ?? ''} · ${fmtDateTimeY(p.site_set_at)}`}</Muted> : null}
          </>
        ) : (
          <Notice tone={colors.amber}>
            {can ? 'Set the site location – supervisors check in against it before the toolbox meeting.' : 'The site location is not set yet – the Senior Electrical Engineer sets it.'}
          </Notice>
        )}
        <Row wrap gap={6} style={{ marginTop: 6 }}>
          {p.site_lat != null && p.site_lng != null ? <Button small variant="ghost" title="Open in Maps" onPress={() => Linking.openURL(mapLink(p.site_lat!, p.site_lng!))} /> : null}
          {can && Platform.OS === 'web' ? <Button small variant="secondary" title={p.site_lat != null ? 'Change on map' : 'Pick on the map'} onPress={() => setPicking(true)} /> : null}
          {can ? <Button small variant="secondary" title="Use my current location" onPress={here} /> : null}
          {can ? <Button small variant="secondary" title="Enter coordinates" onPress={enter} /> : null}
        </Row>
      </Card>
      <LocationPicker
        visible={picking}
        title="Project site – pick the point supervisors check in at"
        query={[p.site_address, p.name].filter(Boolean).join(' ')}
        initial={p.site_lat != null && p.site_lng != null ? { lat: p.site_lat, lng: p.site_lng } : null}
        onClose={() => setPicking(false)}
        onSave={async (pt) => {
          await save(pt.lat, pt.lng, p.site_radius_m ?? 300);
          setPicking(false);
        }}
      />
    </Section>
  );
}
