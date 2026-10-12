import { useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Button, Muted, Row, Segmented } from '@/components/ui';
import { area, bbox, type Pt } from '@/lib/lightcalc';

type Props = { points: Pt[]; closed: boolean; onChange: (points: Pt[], closed: boolean) => void; width: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Draw the plan: tap the corners on a metre grid (snapped, straight walls by default); tap the first corner to close.
 *  The outline is then extruded to the wall height typed below. */
export function PlanDraw({ points, closed, onChange, width }: Props) {
  const fitExtent = () => {
    if (!points.length) return 20;
    const b = bbox(points);
    return Math.max(10, Math.ceil(Math.max(b.x1, b.y1) / 5) * 5 + 5);
  };
  const [extent, setExtent] = useState(fitExtent);
  const [snap, setSnap] = useState<'0.5' | '0.1' | '1'>('0.5');
  const [ortho, setOrtho] = useState(true);
  const pad = 26;
  const W = Math.max(width, 260);
  const sc = (W - 2 * pad) / extent;
  const X = (x: number) => pad + x * sc;
  const Y = (y: number) => W - pad - y * sc;

  const tap = (lx: number, ly: number) => {
    if (closed) return;
    const s = Number(snap);
    let x = Math.min(Math.max(Math.round((lx - pad) / sc / s) * s, 0), extent);
    let y = Math.min(Math.max(Math.round((W - pad - ly) / sc / s) * s, 0), extent);
    const last = points[points.length - 1];
    if (ortho && last) {
      if (Math.abs(x - last.x) >= Math.abs(y - last.y)) y = last.y;
      else x = last.x;
    }
    const first = points[0];
    if (points.length >= 3 && first && (Math.hypot(x - first.x, y - first.y) < Math.max(0.6, 14 / sc) || Math.hypot((lx - X(first.x)) / sc, (ly - Y(first.y)) / sc) < 14 / sc)) {
      onChange(points, true);
      return;
    }
    if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) return;
    onChange([...points, { x: r2(x), y: r2(y) }], false);
  };

  // the grid: every metre, stronger every 5 m, with the metres along the edges
  const grid: string[] = [];
  const minor = extent > 60 ? 5 : 1;
  for (let v = 0; v <= extent + 1e-9; v += minor) {
    const major = Math.abs(v % 5) < 1e-9;
    grid.push(`<line x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(extent)}" stroke="${major ? '#CBD5E1' : '#EEF2F7'}" stroke-width="1"/>`);
    grid.push(`<line x1="${X(0)}" y1="${Y(v)}" x2="${X(extent)}" y2="${Y(v)}" stroke="${major ? '#CBD5E1' : '#EEF2F7'}" stroke-width="1"/>`);
    if (major) {
      grid.push(`<text x="${X(v)}" y="${W - 8}" font-size="10" font-family="Arial" fill="#64748B" text-anchor="middle">${v}</text>`);
      grid.push(`<text x="12" y="${Y(v) + 3}" font-size="10" font-family="Arial" fill="#64748B" text-anchor="middle">${v}</text>`);
    }
  }
  const pts = points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const shape = points.length
    ? closed
      ? `<polygon points="${pts}" fill="#C8102E" fill-opacity="0.08" stroke="#111" stroke-width="2.5"/>`
      : `<polyline points="${pts}" fill="none" stroke="#111" stroke-width="2.5"/>`
    : '';
  const segs = points
    .map((a, i) => {
      if (i === points.length - 1 && !closed) return '';
      const c = points[(i + 1) % points.length];
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      if (len < 0.05) return '';
      return `<text x="${((X(a.x) + X(c.x)) / 2).toFixed(1)}" y="${((Y(a.y) + Y(c.y)) / 2 - 5).toFixed(1)}" font-size="11" font-family="Arial" fill="#1D4ED8" stroke="#fff" stroke-width="3" paint-order="stroke" text-anchor="middle">${len.toFixed(2)} m</text>`;
    })
    .join('');
  const dots = points.map((p, i) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${i === 0 && !closed ? 7 : 4.5}" fill="${i === 0 ? '#C8102E' : '#fff'}" stroke="#111" stroke-width="1.5"/>`).join('');
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><rect width="${W}" height="${W}" fill="#fff"/>${grid.join('')}${shape}${segs}${dots}</svg>`;

  return (
    <View style={{ gap: 6, alignItems: 'center' }}>
      <View style={{ width: W, height: W }}>
        <SvgXml xml={xml} width={W} height={W} />
        {/* an empty layer on top takes the taps, so the position is always measured from the drawing's corner */}
        <View
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: W, cursor: closed ? 'default' : 'crosshair' } as object}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        />
      </View>
      <Muted>
        {closed
          ? `Plan closed · ${area(points).toFixed(1)} m² · ${points.length} corners. Edit the corners below, or Undo to change the last wall.`
          : points.length
            ? points.length >= 3
              ? 'Tap the next corner – tap the red first corner to close the plan.'
              : 'Tap the next corner.'
            : 'Tap the first corner of the room, then walk round it corner by corner.'}
      </Muted>
      <Row gap={6} wrap style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Button small variant="secondary" title="Undo" onPress={() => onChange(closed ? points : points.slice(0, -1), false)} disabled={!points.length} />
        {!closed && points.length >= 3 ? <Button small variant="secondary" title="Close plan" onPress={() => onChange(points, true)} /> : null}
        <Button small variant="ghost" title="Clear" onPress={() => onChange([], false)} disabled={!points.length} />
        <Button small variant="ghost" title="Grid −" onPress={() => setExtent(Math.max(5, extent - 5))} />
        <Button small variant="ghost" title="Grid +" onPress={() => setExtent(Math.min(200, extent + (extent >= 50 ? 25 : 5)))} />
      </Row>
      <Row gap={8} wrap style={{ justifyContent: 'center' }}>
        <Segmented value={snap} onChange={setSnap} options={[{ value: '0.1', label: 'Snap 0.1 m' }, { value: '0.5', label: '0.5 m' }, { value: '1', label: '1 m' }]} />
        <Segmented value={ortho ? 'y' : 'n'} onChange={(v) => setOrtho(v === 'y')} options={[{ value: 'y', label: 'Straight walls' }, { value: 'n', label: 'Any angle' }]} />
      </Row>
      <Muted>{`Grid ${extent} × ${extent} m`}</Muted>
    </View>
  );
}
