import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { Muted } from '@/components/ui';
import { cableArea, cableCircles, packIn, routeOf, type DRoute } from '@/lib/drawings';

/** Cut end of a tray, ladder, trunking or conduit with its cables laid in from the bottom (to scale, mm). */
export function XSection({ cont, cables }: { cont: DRoute; cables: DRoute[] }) {
  const k = routeOf(cont.kind), X = k.xs;
  if (!X) return null;
  const circ = cableCircles(cables);
  let W: number, H: number, placed;
  if (X.type === 'tube') {
    W = H = X.d;
    placed = packIn(circ, 0, X.d, { cx: X.d / 2, R: X.d / 2 });
  } else if (X.type === 'trunk') {
    W = X.w;
    H = X.h;
    placed = [...packIn(circ.filter((c) => c.d === 'power'), 0, W / 2 - 1.5), ...packIn(circ.filter((c) => c.d !== 'power'), W / 2 + 1.5, W)];
  } else {
    W = X.w;
    H = X.h;
    placed = packIn(circ, 0, W);
  }
  const fit = placed.filter((p) => !p.nofit), nofit = placed.length - fit.length;
  const top = Math.max(H, ...fit.map((p) => p.y + p.r));
  const over = fit.some((p) => p.y + p.r > H + 0.3);
  const pad = W * 0.1, vbW = W + 2 * pad, vbH = top + pad * 2.2, sw = W / 160, fs = W / 17;
  const xx = (x: number) => pad + x, yy = (y: number) => pad * 1.2 + top - y;
  const used = cables.reduce((t, c) => t + cableArea(c), 0), cap = k.cap ?? 1, pc = Math.round((100 * used) / cap), limit = k.limit ?? 40;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ backgroundColor: '#F1F3F1', borderRadius: 8 }}>
        <Svg width="100%" height={180} viewBox={`0 0 ${vbW} ${vbH}`}>
          {X.type === 'tube' ? <Circle cx={xx(W / 2)} cy={yy(W / 2)} r={W / 2 + sw} fill="none" stroke="#1a1c1f" strokeWidth={sw * 2} /> : null}
          {X.type === 'ladder' ? (
            <>
              <Rect x={xx(-sw * 4)} y={yy(H)} width={sw * 4} height={H} fill="#1a1c1f" />
              <Rect x={xx(W)} y={yy(H)} width={sw * 4} height={H} fill="#1a1c1f" />
              <Rect x={xx(-sw * 4)} y={yy(0)} width={W + sw * 8} height={sw * 3} fill="#646a72" />
            </>
          ) : null}
          {X.type === 'tray' ? <Polyline points={`${xx(0)},${yy(H)} ${xx(0)},${yy(0)} ${xx(W)},${yy(0)} ${xx(W)},${yy(H)}`} fill="none" stroke="#1a1c1f" strokeWidth={sw * 2} /> : null}
          {X.type === 'trunk' ? (
            <>
              <Rect x={xx(0)} y={yy(H)} width={W} height={H} fill="none" stroke="#1a1c1f" strokeWidth={sw * 2} />
              <Line x1={xx(W / 2)} y1={yy(H)} x2={xx(W / 2)} y2={yy(0)} stroke="#1a1c1f" strokeWidth={sw * 1.5} />
            </>
          ) : null}
          {fit.map((p, i) => (
            <Circle key={i} cx={xx(p.x)} cy={yy(p.y)} r={p.r} fill={p.col} fillOpacity={0.85} stroke="#fff" strokeWidth={sw * 0.5} />
          ))}
          {over ? <Line x1={xx(-pad * 0.6)} y1={yy(H)} x2={xx(W + pad * 0.6)} y2={yy(H)} stroke="#D33A2C" strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} /> : null}
          <SvgText x={xx(W / 2)} y={vbH - pad * 0.25} fontSize={fs} fill="#646a72" textAnchor="middle">
            {X.type === 'tube' ? `Ø ${X.d} mm inside` : `${W} × ${H} mm`}
          </SvgText>
        </Svg>
      </View>
      <Muted style={{ color: pc > limit ? '#D33A2C' : pc > limit * 0.8 ? '#D9921A' : '#1E8A4C', fontWeight: '700' }}>{`${pc}% full of ${cap.toLocaleString()} mm² · limit ${limit}%`}</Muted>
      <Muted>
        {pc > limit
          ? 'No spare – a second run or a bigger size is needed before more cable is pulled.'
          : `Spare up to the limit: ${Math.round((cap * limit) / 100 - used).toLocaleString()} mm² – about ${Math.floor(((cap * limit) / 100 - used) / 30)} more Cat 6.`}
        {over ? ' Cables are piled above the sides – deeper containment or a second tier is needed.' : ''}
        {nofit ? ` ${nofit} cable(s) do not fit.` : ''}
      </Muted>
    </View>
  );
}
