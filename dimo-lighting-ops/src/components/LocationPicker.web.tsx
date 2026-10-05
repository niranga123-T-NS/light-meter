import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, colors, Muted, Row } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';

type Hit = { display_name: string; lat: string; lon: string };
const SRI_LANKA: L.LatLngTuple = [7.8731, 80.7718];

/** Pick a point: search an address (OpenStreetMap), click the map, or use the current position. */
export function LocationPicker({
  visible,
  title,
  query,
  initial,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Prefilled search, e.g. the customer name and address */
  query: string;
  initial?: { lat: number; lng: number } | null;
  onSave: (p: { lat: number; lng: number }) => Promise<void>;
  onClose: () => void;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const pin = useRef<L.CircleMarker | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [q, setQ] = useState(query);
  const [hits, setHits] = useState<Hit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const place = (lat: number, lng: number, zoom?: number) => {
    setPoint({ lat, lng });
    const m = map.current;
    if (!m) return;
    if (pin.current) pin.current.setLatLng([lat, lng]);
    else pin.current = L.circleMarker([lat, lng], { radius: 9, color: '#C8102E', fillColor: '#C8102E', fillOpacity: 0.8, weight: 2 }).addTo(m);
    if (zoom) m.setView([lat, lng], zoom);
  };

  useEffect(() => {
    if (!visible) return;
    // The modal's content mounts after this render
    const t = setTimeout(() => {
      if (!el.current || map.current) return;
      const m = L.map(el.current, { center: initial ? [initial.lat, initial.lng] : SRI_LANKA, zoom: initial ? 15 : 8 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      }).addTo(m);
      m.on('click', (e: L.LeafletMouseEvent) => place(e.latlng.lat, e.latlng.lng));
      map.current = m;
      if (initial) place(initial.lat, initial.lng);
    }, 50);
    return () => {
      clearTimeout(t);
      map.current?.remove();
      map.current = null;
      pin.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const search = async () => {
    if (!q.trim()) return;
    setMsg(null);
    setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=lk&q=${encodeURIComponent(q.trim())}`;
      const r = (await (await fetch(url, { headers: { Accept: 'application/json' } })).json()) as Hit[];
      if (!r.length) setMsg('Not found – try a shorter name, the town, or click the spot on the map.');
      setHits(r);
      if (r.length === 1) place(Number(r[0].lat), Number(r[0].lon), 16);
    } catch {
      setMsg('Search is not available right now – click the spot on the map instead.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, width: '100%', maxWidth: 860, alignSelf: 'center', maxHeight: '96%' }}>
          <ScrollView>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{title}</Text>
            <Muted>Search the address or place, or click the exact spot on the map. Zoom in for accuracy.</Muted>
            <Row gap={8} style={{ marginTop: 8 }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                onSubmitEditing={search}
                placeholder="e.g. Cinnamon Grand Colombo, or Rajagiriya"
                style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 }}
              />
              <Button title="Search" onPress={search} />
            </Row>
            {hits.length > 1 ? (
              <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }}>
                {hits.map((h, i) => (
                  <Pressable key={i} onPress={() => place(Number(h.lat), Number(h.lon), 16)} style={{ padding: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                    <Text style={{ color: colors.ink }} numberOfLines={2}>
                      {h.display_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {msg ? <Muted style={{ marginTop: 6 }}>{msg}</Muted> : null}
            <div ref={el} style={{ height: 380, width: '100%', marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid #E5E7EB' }} />
            <Muted style={{ marginTop: 6 }}>{point ? `Selected: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'No point selected yet'}</Muted>
            <Row wrap gap={8} style={{ marginTop: 10 }}>
              <Button
                title={busy ? 'Saving…' : 'Save location'}
                disabled={!point || busy}
                onPress={async () => {
                  if (!point) return;
                  setBusy(true);
                  try {
                    await onSave(point);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button
                variant="secondary"
                title="Use my current location"
                onPress={async () => {
                  const p = await captureLocation().catch(() => null);
                  if (p) place(p.lat, p.lng, 17);
                  else setMsg('Location not available – allow location access in the browser.');
                }}
              />
              <Button variant="ghost" title="Cancel" onPress={onClose} />
            </Row>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
