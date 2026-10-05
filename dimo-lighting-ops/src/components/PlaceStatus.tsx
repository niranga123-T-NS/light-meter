import { useState } from 'react';
import { Platform } from 'react-native';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, colors, Muted, Pill, Row } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Planning: shows whether the customer / project is on the sales map, and sets its location if not (once – every
 * later visit uses it). Web: search, click on the map or current position; phones: current position. */
export function PlaceStatus({
  projectId,
  organizationId,
  allowChange,
}: {
  projectId: string | null;
  organizationId: string | null;
  /** Customer page: the location can be corrected after it is set */
  allowChange?: boolean;
}) {
  const dialog = useDialog();
  const [picking, setPicking] = useState(false);
  const { data, reload } = useLoad(async () => {
    if (!organizationId) return null;
    const [o, p] = await Promise.all([
      supabase.from('organizations').select('name, lat, lng, address').eq('id', organizationId).maybeSingle(),
      projectId ? supabase.from('projects').select('name, lat, lng, location, city').eq('id', projectId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const org = o.data as { name: string; lat: number | null; lng: number | null; address: string | null } | null;
    const prj = p.data as { name: string; lat: number | null; lng: number | null; location: string | null; city: string | null } | null;
    return { org, prj };
  }, [projectId, organizationId]);
  if (!organizationId || !data?.org) return null;
  // A project visit is placed at the project site, else at the customer
  const target = projectId && data.prj ? { kind: 'project' as const, id: projectId, name: data.prj.name } : { kind: 'customer' as const, id: organizationId, name: data.org.name };
  const placed = (projectId && data.prj?.lat != null) || data.org.lat != null;
  const save = async (pt: { lat: number; lng: number }) => {
    await dialog.run(async () => {
      await rpc('set_map_location', { p_kind: target.kind, p_id: target.id, p_lat: pt.lat, p_lng: pt.lng });
      setPicking(false);
      await reload();
    }, target.kind === 'project' ? 'Project site saved' : 'Customer location saved');
  };
  return (
    <Row wrap gap={8} style={{ alignItems: 'center', marginVertical: 4 }}>
      <Pill
        label={placed ? (projectId && data.prj?.lat != null ? '📍 Project site on the map' : '📍 Customer on the map') : 'No map location yet'}
        tone={placed ? colors.green : colors.amber}
      />
      {!placed || (projectId && data.prj?.lat == null) || allowChange ? (
        <Button
          small
          variant="secondary"
          title={placed && allowChange ? 'Change location' : target.kind === 'project' ? 'Set project site' : 'Set customer location'}
          onPress={async () => {
            if (Platform.OS === 'web') return setPicking(true);
            const ok = await dialog.confirm(
              target.kind === 'project' ? 'Use where you are now as the project site?' : 'Use where you are now as the customer location?',
              'Only if you are at the place now. Otherwise set it later in the web app (Map), or it is set by your first GPS check-in there.',
              { confirmLabel: 'Use my location' },
            );
            if (!ok) return;
            const pos = await captureLocation().catch(() => null);
            if (!pos) return dialog.toast('Location not available – allow location access', 'error');
            await save(pos);
          }}
        />
      ) : null}
      {!placed ? <Muted>Or it is set automatically by the first GPS check-in there.</Muted> : null}
      {placed && allowChange ? <Muted>Visits are GPS-verified within 500 m of this point.</Muted> : null}
      <LocationPicker
        visible={picking}
        title={`${target.kind === 'project' ? 'Project site' : 'Customer location'} – ${target.name}`}
        query={
          target.kind === 'project'
            ? [data.prj?.location, data.prj?.city].filter(Boolean).join(', ') || `${target.name} ${data.org.name}`
            : data.org.address || data.org.name
        }
        initial={
          target.kind === 'project'
            ? data.prj?.lat != null && data.prj.lng != null
              ? { lat: data.prj.lat, lng: data.prj.lng }
              : null
            : data.org.lat != null && data.org.lng != null
              ? { lat: data.org.lat, lng: data.org.lng }
              : null
        }
        onClose={() => setPicking(false)}
        onSave={save}
      />
    </Row>
  );
}
