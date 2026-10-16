import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, G, Line, Polyline } from 'react-native-svg';
import { colors } from '@/components/ui';
import { DISC, isCont, kindOf, offsetLine, routeOf, STATUS_COLOR, toU, type DItem, type Disc, type Drawing, type DRoute, type Pt } from '@/lib/drawings';

export type StageLayer = 'progress' | 'services';

const P = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

function Containment({ r, pts, col, sel }: { r: DRoute; pts: Pt[]; col: string; sel: boolean }) {
  const k = routeOf(r.kind), w = k.w, hw = w / 2, dash = r.status === 'planned' ? '7 5' : undefined;
  const line = P(pts);
  const out = [];
  if (sel) out.push(<Polyline key="s" points={line} fill="none" stroke={colors.brand} strokeOpacity={0.3} strokeWidth={w + 10} />);
  if (r.kind === 'ladder') {
    out.push(<Polyline key="b" points={line} fill="none" stroke={col} strokeOpacity={0.1} strokeWidth={w} />);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      for (let t = 6; t < L - 3; t += 12) {
        const cx = a[0] + ux * t, cy = a[1] + uy * t;
        out.push(<Line key={`r${i}-${t}`} x1={cx - uy * hw} y1={cy + ux * hw} x2={cx + uy * hw} y2={cy - ux * hw} stroke={col} strokeWidth={1.5} strokeDasharray={dash} />);
      }
    }
    out.push(<Polyline key="l1" points={P(offsetLine(pts, hw))} fill="none" stroke={col} strokeWidth={2.3} strokeDasharray={dash} />);
    out.push(<Polyline key="l2" points={P(offsetLine(pts, -hw))} fill="none" stroke={col} strokeWidth={2.3} strokeDasharray={dash} />);
  } else {
    out.push(<Polyline key="o" points={line} fill="none" stroke={col} strokeWidth={w + 2.6} strokeLinejoin="miter" strokeLinecap="square" strokeDasharray={dash} />);
    out.push(<Polyline key="i" points={line} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={Math.max(1, w - 0.6)} strokeLinejoin="miter" strokeLinecap="square" />);
    if (r.kind === 'tray') out.push(<Polyline key="p" points={line} fill="none" stroke={col} strokeOpacity={0.55} strokeWidth={w - 6} strokeDasharray="1.2 4.5" strokeLinecap="round" />);
    if (r.kind === 'trunk') {
      out.push(<Polyline key="t1" points={P(offsetLine(pts, hw / 3))} fill="none" stroke={col} strokeOpacity={0.6} strokeWidth={0.9} />);
      out.push(<Polyline key="t2" points={P(offsetLine(pts, -hw / 3))} fill="none" stroke={col} strokeOpacity={0.6} strokeWidth={0.9} />);
    }
  }
  return <G>{out}</G>;
}

/**
 * The drawing with its routes and items. Taps on the sheet come back in sheet units (x 0–1000); the parent decides what
 * a tap means (place an item, add a route point, set the scale, or pick the nearest route).
 */
export function Stage({
  drawing,
  uri,
  items,
  routes,
  layer,
  show,
  selected,
  draft,
  zoom,
  onTap,
  onItem,
}: {
  drawing: Drawing;
  uri: string | null;
  items: DItem[];
  routes: DRoute[];
  layer: StageLayer;
  show: (d: Disc) => boolean;
  selected: string | null;
  draft: Pt[] | null;
  zoom: number;
  onTap: (p: Pt) => void;
  onItem: (it: DItem) => void;
}) {
  const [box, setBox] = useState(0);
  const W = box * zoom;
  const H = (W * drawing.height) / drawing.width;
  const VH = (1000 * drawing.height) / drawing.width;
  const tap = (e: GestureResponderEvent) => {
    if (!W) return;
    // (the website gives the position as offsetX / offsetY on the press target)
    const ne = e.nativeEvent as unknown as { locationX?: number; locationY?: number; offsetX?: number; offsetY?: number };
    const lx = ne.locationX ?? ne.offsetX, ly = ne.locationY ?? ne.offsetY;
    if (lx == null || ly == null || Number.isNaN(lx)) return;
    onTap([(lx / W) * 1000, (ly / W) * 1000]);
  };
  const order = [...routes].sort((a, b) => (isCont(a.kind) ? 0 : 1) - (isCont(b.kind) ? 0 : 1));
  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)} style={{ width: '100%', borderRadius: 10, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', backgroundColor: '#fff' }}>
      <ScrollView horizontal scrollEnabled={zoom > 1} style={{ maxHeight: Math.min(H || 300, 900) }}>
        <ScrollView scrollEnabled nestedScrollEnabled>
          <View style={{ width: W || '100%', height: H || 300 }}>
            {uri ? <Image source={{ uri }} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} contentFit="fill" /> : null}
            <Pressable testID="drawing-stage" onPress={tap} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} accessibilityLabel="Drawing" />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
              {W ? (
                <Svg width={W} height={H} viewBox={`0 0 1000 ${VH}`}>
                  {order.map((r) => {
                    const k = routeOf(r.kind);
                    if (!show(k.d)) return null;
                    const pts = r.pts.map((p) => toU(drawing, p));
                    const col = layer === 'services' ? DISC[k.d].c : (STATUS_COLOR[r.status] ?? '#9AA0A8');
                    const sel = selected === r.id;
                    if (isCont(r.kind)) return <Containment key={r.id} r={r} pts={pts} col={layer === 'services' ? DISC.cont.c : col} sel={sel} />;
                    const total = pts.reduce((t, p, i) => (i ? t + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
                    const done = (total * (r.laid ?? 0)) / 100;
                    return (
                      <G key={r.id}>
                        {sel ? <Polyline points={P(pts)} fill="none" stroke={colors.brand} strokeOpacity={0.3} strokeWidth={10} /> : null}
                        <Polyline points={P(pts)} fill="none" stroke={DISC[k.d].c} strokeOpacity={0.45} strokeWidth={k.w} strokeDasharray="4 4" />
                        {done > 0 ? <Polyline points={P(pts)} fill="none" stroke={layer === 'services' ? DISC[k.d].c : col} strokeWidth={k.w + 0.4} strokeDasharray={`${done.toFixed(1)} ${(total + 10).toFixed(1)}`} /> : null}
                      </G>
                    );
                  })}
                  {draft && draft.length ? (
                    <G>
                      <Polyline points={P(draft)} fill="none" stroke={colors.brand} strokeWidth={3} />
                      {draft.map((p, i) => (
                        <Circle key={i} cx={p[0]} cy={p[1]} r={4.5} fill={colors.brand} />
                      ))}
                    </G>
                  ) : null}
                </Svg>
              ) : null}
            </View>
            {W
              ? items.map((it) => {
                  const k = kindOf(it.kind);
                  if (!show(k.d)) return null;
                  const c = layer === 'services' ? DISC[k.d].c : (STATUS_COLOR[it.status] ?? '#9AA0A8');
                  const sel = selected === it.id;
                  const big = !!k.big;
                  const text = big ? (it.label ? it.label.split(' ')[0] : k.code) : k.code;
                  return (
                    <Pressable
                      key={it.id}
                      onPress={() => onItem(it)}
                      accessibilityLabel={`${k.name} ${it.label ?? ''}`}
                      style={{
                        position: 'absolute',
                        left: it.x * W,
                        top: it.y * H,
                        transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
                        backgroundColor: c,
                        borderRadius: 5,
                        paddingHorizontal: big ? 5 : 3,
                        paddingVertical: big ? 3 : 1,
                        minWidth: 18,
                        alignItems: 'center',
                        borderWidth: sel ? 3 : 1.5,
                        borderColor: sel ? colors.brand : '#fff',
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: big ? 10 : 8.5, fontWeight: '800' }}>{text}</Text>
                    </Pressable>
                  );
                })
              : null}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
