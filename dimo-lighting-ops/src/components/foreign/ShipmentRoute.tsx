import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { Button, Muted, Row } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { FoOrder, Shipment } from '@/lib/foreignOrders';
import { findPlace, fmtCoords, knownPlace, nearestArea, parseCoords } from '@/lib/places';
import { openLink } from '@/lib/catalog';
import { estimatedPosition, lanePath, trackingLinks } from '@/lib/tracking';
import { Platform } from 'react-native';
import { rpc } from './actions';
import { RouteMap } from './RouteMap';

export type FoPosition = { id: string; shipment_id: string; at: string; place: string; lat: number; lng: number; note: string | null };

const inlandOf = (o: FoOrder) => (o.kind !== 'material' ? null : o.incoterm === 'CIF' ? 'manufacturer' : 'forwarder') as 'forwarder' | 'manufacturer' | null;

/** The route map of a shipment with its last known positions; Ops records a position when they check the tracking. */
export function ShipmentRoute({
  shipment,
  orders,
  site,
  positions,
  keeper,
  onChange,
}: {
  shipment: Shipment;
  orders: FoOrder[];
  site: string | null;
  positions: FoPosition[];
  keeper: boolean;
  onChange: () => void;
}) {
  const dialog = useDialog();
  const [pick, setPick] = useState<{ place: string; at: string; note: string; start: { lat: number; lng: number } | null } | null>(null);
  const factories = orders.map((o) => ({ label: `${o.code} ${o.vendor}`, location: o.factory_location, lat: o.factory_lat, lng: o.factory_lng, inland: inlandOf(o) }));

  // a point at sea is named by the nearest sea area or port
  const nameOf = (place: string, at: { lat: number; lng: number }) => (place && !parseCoords(place) ? place : `${nearestArea(at) ?? 'At sea'} · ${fmtCoords(at)}`);
  const save = async (r: { place: string; at: string; note: string }, at: { lat: number; lng: number }) => {
    await dialog.run(async () => {
      const when = new Date(`${r.at.trim().replace(' ', 'T')}:00+05:30`);
      if (Number.isNaN(when.getTime())) throw new Error('When: enter the date and time as 2026-10-13 08:30');
      await rpc('fo_add_position', { p_shipment: shipment.id, p: { at: when.toISOString(), place: nameOf(r.place, at), lat: at.lat, lng: at.lng, note: r.note } });
      onChange();
    }, 'Position recorded');
  };
  // where the map picker starts: the estimate from the ETD and ETA, else the last known position
  const startPoint = () => {
    const chain = [shipment.pol, ...(shipment.via ?? '').split(/[,;→>]+/), shipment.pod].map((x) => knownPlace(x?.trim(), shipment.mode)).filter((x): x is NonNullable<typeof x> => !!x);
    const est = estimatedPosition(lanePath(chain, shipment.mode), shipment.etd, shipment.eta);
    const last = [...positions].sort((a, b) => b.at.localeCompare(a.at))[0];
    return est ? { lat: est.lat, lng: est.lng } : last ? { lat: last.lat, lng: last.lng } : chain[0] ? { lat: chain[0].lat, lng: chain[0].lng } : null;
  };
  const record = async () => {
    const now = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const sea = shipment.mode === 'sea';
    const r = await dialog.prompt({
      title: 'Last known position',
      message: sea
        ? 'Open the vessel with the tracking button (MarineTraffic / VesselFinder) and copy the latitude and longitude it shows – or type the port or sea it is in. Leave it empty to click the spot on a world map.'
        : 'From the tracking page: the airport or place it was last scanned at. Leave it empty to click the spot on a world map.',
      fields: [
        { key: 'place', label: sea ? 'Position – coordinates, port or sea' : 'Where (airport or place)', hint: sea ? 'e.g. 12.62 N 58.41 E · 12.6214, 58.4102 · Jebel Ali · Gulf of Aden' : 'e.g. DXB, Dubai' },
        { key: 'at', label: 'When (Sri Lanka time)', required: true, initial: now, hint: 'The time the site shows for the position, e.g. 2026-10-13 08:30' },
        { key: 'note', label: 'Note', hint: 'e.g. underway 14 kn, at anchor, transhipment, on schedule' },
      ],
      confirmLabel: 'Next',
    });
    if (!r) return;
    const v = { place: r.place.trim(), at: r.at, note: r.note ?? '' };
    // coordinates: placed exactly, named by the nearest sea area
    const xy = parseCoords(v.place);
    if (xy) return save(v, xy);
    if (!v.place) return setPick({ ...v, start: startPoint() });
    const hit = await findPlace(v.place, { mode: shipment.mode });
    if (hit && (await dialog.confirm(`Place it at ${hit.name}?`, hit.kind === 'place' && sea ? 'A sea area is placed at its middle – for the exact spot, cancel and click it on the map, or enter the coordinates.' : 'Cancel to mark the point on the map yourself.', { confirmLabel: 'Yes' }))) await save(v, hit);
    else setPick({ ...v, start: hit ?? startPoint() });
  };
  const remove = async (id: string) => {
    if (await dialog.confirm('Remove this position?')) await dialog.run(async () => { await rpc('fo_remove_position', { p_id: id }); onChange(); }, 'Removed');
  };
  const links = trackingLinks(shipment);
  const track = async (l: { url: string; copy?: string }) => {
    if (l.copy && Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(l.copy);
        dialog.toast(`${l.copy} copied – paste it if the page asks for it`);
      } catch {
        // no clipboard – the number is on the button
      }
    }
    await openLink(l.url);
  };
  const sorted = [...positions].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <RouteMap
        mode={shipment.mode}
        factories={factories}
        pol={shipment.pol}
        vias={(shipment.via ?? '').split(/[,;→>]+/).map((x) => x.trim()).filter(Boolean)}
        pod={shipment.pod}
        site={site}
        arrived={!!shipment.arrived_on}
        etd={shipment.etd}
        eta={shipment.eta}
        positions={positions}
        onFactoryFound={keeper ? (i, at) => { const o = orders[i]; if (o) rpc('fo_set_factory', { p_order: o.id, p_location: o.factory_location, p_lat: at.lat, p_lng: at.lng }).catch(() => undefined); } : undefined}
      />
      {links.length ? (
        <Row wrap gap={8}>
          {links.map((l) => (
            <Button key={l.label} small variant="ghost" title={`↗ ${l.label}`} onPress={() => track(l)} />
          ))}
        </Row>
      ) : !shipment.arrived_on ? (
        <Muted>Add the vessel’s IMO number and the container numbers (Edit / ETA) for one-tap tracking links.</Muted>
      ) : null}
      {keeper && !shipment.arrived_on ? (
        <Row gap={8}>
          <Button small variant="secondary" title="+ Last known position" onPress={record} />
        </Row>
      ) : null}
      {sorted.slice(0, 6).map((x, i) => (
        <Row key={x.id} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Muted>{`${i === 0 ? 'Last known: ' : ''}${x.place} · ${fmtDateTime(x.at)}${x.note ? ` · ${x.note}` : ''}`}</Muted>
          {keeper ? <Button small variant="ghost" title="Remove" onPress={() => remove(x.id)} /> : null}
        </Row>
      ))}
      {pick ? (
        <LocationPicker
          visible
          title={pick.place ? `Mark: ${pick.place}` : 'Mark the last known position'}
          query={pick.place}
          initial={pick.start}
          world
          onClose={() => setPick(null)}
          onSave={async (at) => {
            await save(pick, at);
            setPick(null);
          }}
        />
      ) : null}
    </>
  );
}
