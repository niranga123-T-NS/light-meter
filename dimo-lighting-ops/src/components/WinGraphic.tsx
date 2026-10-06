import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { CHART } from './charts';
import { colors, Row } from './ui';

// Live picture for the Win Probability Wizard: a ring with the wizard % (tick = the project's current %), how the % moved
// with each change in this session, and each pillar – us against the best competitor – with its weight.
export type PillarBar = { label: string; us: number; rival: number; weight: number; state: 'scored' | 'unknown' | 'absent' };

const US = CHART.actual;
const RIVAL = CHART.second;

function Ring({ pct, manual, size = 112 }: { pct: number; manual: number; size?: number }) {
  const sw = 10;
  const r = (size - sw) / 2 - 2;
  const c = size / 2;
  const len = 2 * Math.PI * r;
  const at = (p: number) => {
    const a = (p / 100) * 2 * Math.PI - Math.PI / 2;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r, cos: Math.cos(a), sin: Math.sin(a) };
  };
  const m = at(manual);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke={CHART.grid} strokeWidth={sw} fill="none" />
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={US}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(len * Math.max(0.5, pct)) / 100} ${len}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
        {/* Tick: the project's current (manual or approved) % */}
        <Line x1={m.x - m.cos * 9} y1={m.y - m.sin * 9} x2={m.x + m.cos * 9} y2={m.y + m.sin * 9} stroke={colors.ink} strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink }}>{`${Math.round(pct)}%`}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>wizard</Text>
      </View>
    </View>
  );
}

function Spark({ trail, manual, w = 170, h = 64 }: { trail: number[]; manual: number; w?: number; h?: number }) {
  const pts = trail.slice(-30);
  const pad = 6;
  const x = (i: number) => (pts.length <= 1 ? w / 2 : pad + ((w - 2 * pad) * i) / (pts.length - 1));
  // Zoom to the values (at least a 20-point window) so each change is visible
  const lo0 = Math.min(...pts);
  const hi0 = Math.max(...pts);
  const mid = (lo0 + hi0) / 2;
  const half = Math.max(10, (hi0 - lo0) / 2 + 3);
  const lo = Math.max(0, mid - half);
  const hi = Math.min(100, lo + 2 * half);
  const y = (v: number) => pad + (h - 2 * pad) * (1 - (v - lo) / (hi - lo || 1));
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <Svg width={w} height={h}>
      <Line x1={0} x2={w} y1={h - 1} y2={h - 1} stroke={CHART.grid} strokeWidth={1} />
      {manual >= lo && manual <= hi ? <Line x1={0} x2={w} y1={y(manual)} y2={y(manual)} stroke={CHART.budget} strokeWidth={1.5} strokeDasharray="4 4" /> : null}
      {pts.length > 1 ? <Path d={d} stroke={US} strokeWidth={2} fill="none" strokeLinejoin="round" /> : null}
      {pts.length ? <Circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r={4.5} fill={US} stroke="#fff" strokeWidth={2} /> : null}
    </Svg>
  );
}

function Bar({ v, color }: { v: number; color: string }) {
  return (
    <View style={{ height: 6, backgroundColor: CHART.grid, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, v * 100))}%`, height: 6, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

export function WinGraphic({ pct, manual, trail, pillars }: { pct: number; manual: number; trail: number[]; pillars: PillarBar[] }) {
  const prev = trail.length > 1 ? trail[trail.length - 2] : null;
  const delta = prev == null ? 0 : Math.round(pct) - prev;
  const first = trail[0] ?? Math.round(pct);
  return (
    <Row wrap gap={18} style={{ alignItems: 'flex-start' }}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Ring pct={pct} manual={manual} />
        <Text style={{ fontSize: 12, color: colors.muted }}>{`▮ tick = now ${manual}%`}</Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>As you change it</Text>
        <Spark trail={trail.length ? trail : [Math.round(pct)]} manual={manual} />
        <Text style={{ fontSize: 12, color: delta > 0 ? colors.green : delta < 0 ? colors.red : colors.muted }}>
          {delta > 0 ? `▲ +${delta} pts last change` : delta < 0 ? `▼ ${delta} pts last change` : 'No change yet'}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{`Started at ${first}% · project now ${manual}% · ${trail.length > 1 ? `${trail.length - 1} change${trail.length === 2 ? '' : 's'}` : 'make a change to see it move'}`}</Text>
      </View>

      <View style={{ gap: 6, minWidth: 240, flex: 1 }}>
        <Row gap={12}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>Pillars</Text>
          <Row gap={4}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: US }} />
            <Text style={{ fontSize: 12, color: colors.muted }}>Us</Text>
          </Row>
          <Row gap={4}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: RIVAL }} />
            <Text style={{ fontSize: 12, color: colors.muted }}>Best competitor</Text>
          </Row>
        </Row>
        {pillars.map((p) => (
          <View key={p.label} style={{ gap: 2 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '600' }}>{`${p.label} · weight ${Math.round(p.weight * 100)}%`}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {p.state === 'absent' ? 'not on this project' : p.state === 'unknown' ? 'not yet known (neutral)' : `${Math.round(p.us * 100)} vs ${Math.round(p.rival * 100)}`}
              </Text>
            </Row>
            {p.state === 'absent' ? null : (
              <View style={{ gap: 2, opacity: p.state === 'unknown' ? 0.45 : 1 }}>
                <Bar v={p.us} color={US} />
                <Bar v={p.rival} color={RIVAL} />
              </View>
            )}
          </View>
        ))}
      </View>
    </Row>
  );
}
