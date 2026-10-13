// Electricity tariffs (PUCSL schedule) for the savings in DLux: a flat energy charge, or time-of-use rates priced by
// when the lights are on.

export type Tariff = {
  id: string;
  supplier: 'EDL' | 'LECO' | 'CEB';
  code: string;
  name: string;
  family: string | null;
  rate: number | null;
  peak: number | null;
  day: number | null;
  off_peak: number | null;
  fixed: number | null;
  demand: number | null;
  note: string | null;
  effective_from: string | null;
};
export type LightsOn = 'day' | 'mixed' | 'evening' | 'night';
export const LIGHTS_ON: { value: LightsOn; label: string }[] = [
  { value: 'day', label: 'Daytime (05:30–18:30)' },
  { value: 'mixed', label: 'Day + evening' },
  { value: 'evening', label: 'Evening peak (18:30–22:30)' },
  { value: 'night', label: 'Dusk to dawn' },
];
export const isTou = (t: Tariff) => t.rate == null && t.day != null;

/** LKR per kWh saved: the flat rate, or the time-of-use rates weighted by when the lights burn */
export function tariffRate(t: Tariff | null, on: LightsOn = 'day'): number | null {
  if (!t) return null;
  if (!isTou(t)) return t.rate;
  const pk = t.peak ?? t.day ?? 0;
  const dy = t.day ?? 0;
  const op = t.off_peak ?? t.day ?? 0;
  const r = on === 'day' ? dy : on === 'evening' ? pk : on === 'mixed' ? (dy * 3 + pk) / 4 : (pk * 4 + op * 7) / 11; // dusk to dawn: 18:30–05:30
  return Math.round(r * 100) / 100;
}

export const tariffSummary = (t: Tariff) =>
  isTou(t) ? `peak ${t.peak} · day ${t.day} · off-peak ${t.off_peak} LKR/kWh` : t.rate != null ? `${t.rate} LKR/kWh` : 'rate not set';
export const tariffLabel = (t: Tariff) => `${t.supplier} ${t.code} · ${t.name} · ${tariffSummary(t)}`;
