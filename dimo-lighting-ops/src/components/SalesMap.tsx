import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ACADEMY_SITE } from '@/lib/academy';
import type { MapProps } from './SalesMap.types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// The same Leaflet map as the web app, inside a web view: OpenStreetMap tiles, circles, numbered stops, lines and the heat layer.
// The data goes in with draw(...); "Open" in a popup comes back as a message and goes through the app's router.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{height:100%;margin:0}.leaflet-popup-content{font:13px -apple-system,Roboto,sans-serif}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<script>
var m = L.map('m', { center: [7.8731, 80.7718], zoom: 8 });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
var g = L.layerGroup().addTo(m), fitted = null;
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('[data-href]');
  if (a) { e.preventDefault(); window.ReactNativeWebView.postMessage(a.getAttribute('data-href')); }
});
window.draw = function (d) {
  g.clearLayers();
  (d.lines || []).forEach(function (ln) { if (ln.coords.length > 1) L.polyline(ln.coords, { color: ln.color, weight: ln.weight || 3, opacity: 0.8, dashArray: ln.dashed ? '6 6' : null }).addTo(g); });
  if (d.heat && d.heat.length && L.heatLayer) L.heatLayer(d.heat, { radius: 22, blur: 18, maxZoom: 13, minOpacity: 0.35 }).addTo(g);
  d.points.forEach(function (p) {
    var mk = p.number
      ? L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div style="width:24px;height:24px;border-radius:12px;background:' + p.color + ';color:#fff;font:700 12px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">' + p.number + '</div>' }) })
      : L.circleMarker([p.lat, p.lng], { radius: p.radius || 7, color: p.color, weight: p.hollow ? 2.5 : 1.5, fillColor: p.color, fillOpacity: p.hollow ? 0.08 : 0.75, dashArray: p.dashed ? '3 3' : null });
    mk.bindPopup(p.html, { maxWidth: 260 }).addTo(g);
  });
  if (fitted !== d.fitKey) {
    var all = d.points.map(function (p) { return [p.lat, p.lng]; }).concat([].concat.apply([], (d.lines || []).map(function (l) { return l.coords; }))).concat((d.heat || []).map(function (h) { return [h[0], h[1]]; }));
    if (all.length) { m.fitBounds(L.latLngBounds(all), { padding: [30, 30], maxZoom: d.maxZoom || 15 }); fitted = d.fitKey; }
  }
};
window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

/** The sales map in the phone app (needs app 0.6.0 or later – the web view). */
export function SalesMap({ points, lines = [], heat, fitKey, onOpen, height = 560, maxZoom = 15 }: MapProps) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const data = useMemo(
    () => JSON.stringify({ fitKey, maxZoom, lines, heat: heat ?? [], points: points.map((p) => ({ ...p, html: `${p.label}${p.href ? `<div style="margin-top:6px"><a href="#" data-href="${esc(p.href)}" style="font-weight:600">Open</a></div>` : ''}` })) }),
    [points, lines, heat, fitKey, maxZoom],
  );
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.draw(${data});true;`);
  }, [ready, data]);
  const onMessage = (e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'ready') setReady(true);
    else if (msg.startsWith('/')) onOpen?.(msg);
  };
  return (
    <View style={{ height: Math.min(height, 520), borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' }}>
      <WebView ref={web} source={{ html: PAGE, baseUrl: ACADEMY_SITE }} originWhitelist={['*']} onMessage={onMessage} javaScriptEnabled domStorageEnabled nestedScrollEnabled setSupportMultipleWindows={false} />
    </View>
  );
}

export const mapEscape = esc;
