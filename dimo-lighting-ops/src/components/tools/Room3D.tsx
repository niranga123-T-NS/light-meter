import { useState } from 'react';
import { PanResponder, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Button, Muted, Row } from '@/components/ui';
import { room3dSvg, type Scale } from '@/lib/calcSheet';
import type { CalcResult, Pt } from '@/lib/lightcalc';

type Props = {
  poly: Pt[];
  positions: Pt[];
  room: { height: number; mount: number; plane: number };
  r: CalcResult | null;
  scale: Scale;
  fit: { lumL: number; lumW: number };
  width: number;
};
const START = { yaw: 35, pitch: 55, zoom: 1 };

/** The room in 3D – drag to turn it round and tilt it, buttons for a step at a time and zoom */
export function Room3D({ poly, positions, room, r, scale, fit, width }: Props) {
  const [view, setView] = useState(START);
  // turned by the movement since the last move, so no stored starting view is needed
  const [pan] = useState(() => {
    let last = { dx: 0, dy: 0 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        last = { dx: 0, dy: 0 };
      },
      onPanResponderMove: (_, g) => {
        const mx = g.dx - last.dx;
        const my = g.dy - last.dy;
        last = { dx: g.dx, dy: g.dy };
        setView((v) => ({ ...v, yaw: (v.yaw - mx * 0.5) % 360, pitch: Math.min(89, Math.max(5, v.pitch + my * 0.4)) }));
      },
    });
  });
  const svg = room3dSvg(poly, positions, room, r, scale, fit, view.yaw, view.pitch, width, view.zoom);
  const step = (p: Partial<typeof START>) => setView((v) => ({ ...v, ...p }));
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View {...pan.panHandlers} style={{ cursor: 'grab' } as object}>
        <SvgXml xml={svg.xml} width={svg.width} height={svg.height} />
      </View>
      <Muted>Drag to turn and tilt the room.</Muted>
      <Row gap={6} wrap style={{ justifyContent: 'center' }}>
        <Button small variant="secondary" title="⟲" onPress={() => step({ yaw: view.yaw + 30 })} />
        <Button small variant="secondary" title="⟳" onPress={() => step({ yaw: view.yaw - 30 })} />
        <Button small variant="secondary" title="Tilt ▲" onPress={() => step({ pitch: Math.max(5, view.pitch - 10) })} />
        <Button small variant="secondary" title="Tilt ▼" onPress={() => step({ pitch: Math.min(89, view.pitch + 10) })} />
        <Button small variant="secondary" title="＋" onPress={() => step({ zoom: Math.min(2.5, view.zoom * 1.2) })} />
        <Button small variant="secondary" title="－" onPress={() => step({ zoom: Math.max(0.5, view.zoom / 1.2) })} />
        <Button small variant="ghost" title="Top" onPress={() => step({ yaw: 0, pitch: 89 })} />
        <Button small variant="ghost" title="Reset" onPress={() => setView(START)} />
      </Row>
    </View>
  );
}
