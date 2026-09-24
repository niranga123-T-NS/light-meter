export type Unit = 'lux' | 'fc';
export const LUX_PER_FC = 10.7639;

export function formatValue(lux: number, unit: Unit): string {
  const v = unit === 'lux' ? lux : lux / LUX_PER_FC;
  if (v >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return Math.round(v).toString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export const unitLabel = (unit: Unit) => (unit === 'lux' ? 'lux' : 'foot-candles');

// Illuminance ↔ exposure value at ISO 100, incident-meter constant C = 250.
export const luxToEv100 = (lux: number) => Math.log2(lux / 2.5);

// Log-scale position of a reading between 1 and 100k lux, as 0..1.
export function logFraction(lux: number, min = 1, max = 100000): number {
  const f = Math.log10(Math.max(lux, min) / min) / Math.log10(max / min);
  return Math.min(1, Math.max(0, f));
}
