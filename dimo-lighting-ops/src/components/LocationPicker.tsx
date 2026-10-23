import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Button, colors, Muted, Row } from '@/components/ui';
import { captureLocation } from '@/components/VisitBits';

type Hit = { display_name: string; lat: string; lon: string };

// The same Leaflet map as the web picker, inside a web view: a tap on the map comes back as "lat,lng"; place(...) moves the pin
const page = (lat: number, lng: number, zoom: number, pin: boolean) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var m = L.map('m', { center: [${lat}, ${lng}], zoom: ${zoom} }), p = null;
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
window.place = function (a, b, z) { if (p) p.setLatLng([a, b]); else p = L.circleMarker([a, b], { radius: 9, color: '#C8102E', fillColor: '#C8102E', fillOpacity: 0.8, weight: 2 }).addTo(m); if (z) m.setView([a, b], z); };
m.on('click', function (e) { window.place(e.latlng.lat, e.latlng.lng); window.ReactNativeWebView.postMessage(e.latlng.lat + ',' + e.latlng.lng); });
${pin ? `window.place(${lat}, ${lng});` : ''}
</script></body></html>`;

/** Pick a point on the phone or tablet: search an address (OpenStreetMap), tap the map, or use the current position. */
export function LocationPicker({
  visible,
  title,
  query,
  initial,
  world,
  onSave,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Prefilled search, e.g. the customer name and address */
  query: string;
  initial?: { lat: number; lng: number } | null;
  /** A point anywhere in the world (a ship at sea): worldwide search, wide zoom, no "my location" */
  world?: boolean;
  onSave: (p: { lat: number; lng: number }) => Promise<void>;
  onClose: () => void;
}) {
  const web = useRef<WebView>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [q, setQ] = useState(query);
  const [hits, setHits] = useState<Hit[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [html] = useState(() => page(initial?.lat ?? 7.8731, initial?.lng ?? 80.7718, initial ? (world ? 5 : 15) : world ? 3 : 8, !!initial));

  const place = (lat: number, lng: number, zoom?: number) => {
    setPoint({ lat, lng });
    web.current?.injectJavaScript(`window.place(${lat}, ${lng}${zoom ? `, ${zoom}` : ''}); true;`);
  };

  const search = async () => {
    if (!q.trim()) return;
    setMsg(null);
    setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6${world ? '' : '&countrycodes=lk'}&q=${encodeURIComponent(q.trim())}`;
      const r = (await (await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DIMO Lighting Ops' } })).json()) as Hit[];
      if (!r.length) setMsg('Not found – try a shorter name, the town, or tap the spot on the map.');
      setHits(r);
      if (r.length === 1) place(Number(r[0].lat), Number(r[0].lon), world ? 6 : 16);
    } catch {
      setMsg('Search is not available right now – tap the spot on the map instead.');
    }
  };

  const onMessage = (e: WebViewMessageEvent) => {
    const [a, b] = e.nativeEvent.data.split(',').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) setPoint({ lat: a, lng: b });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, width: '100%', maxWidth: 860, alignSelf: 'center', maxHeight: '96%' }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{title}</Text>
            <Muted>{world ? 'Tap where the ship is on the map. Search finds a port, sea or place.' : 'Search the address or place, or tap the exact spot on the map. Zoom in for accuracy – or stand at the site and use your current location.'}</Muted>
            <Row gap={8} style={{ marginTop: 8 }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                onSubmitEditing={search}
                returnKeyType="search"
                placeholder={world ? 'e.g. Gulf of Aden, Salalah' : 'e.g. Cinnamon Grand Colombo, or Rajagiriya'}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: colors.ink }}
              />
              <Button title="Search" onPress={search} />
            </Row>
            {hits.length > 1 ? (
              <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }}>
                {hits.map((h, i) => (
                  <Pressable key={i} onPress={() => place(Number(h.lat), Number(h.lon), world ? 6 : 16)} style={{ padding: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                    <Text style={{ color: colors.ink }} numberOfLines={2}>
                      {h.display_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {msg ? <Muted style={{ marginTop: 6 }}>{msg}</Muted> : null}
            <View style={{ height: 380, marginTop: 10, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.line }}>
              {visible ? <WebView ref={web} originWhitelist={['*']} source={{ html }} onMessage={onMessage} javaScriptEnabled style={{ flex: 1 }} /> : null}
            </View>
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
              {world ? null : (
                <Button
                  variant="secondary"
                  title="Use my current location"
                  onPress={async () => {
                    const p = await captureLocation().catch(() => null);
                    if (p) place(p.lat, p.lng, 17);
                    else setMsg('Location not available – allow location access for the app in Settings.');
                  }}
                />
              )}
              <Button variant="ghost" title="Cancel" onPress={onClose} />
            </Row>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
