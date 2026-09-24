export const ISO_VALUES = [50, 100, 200, 400, 800, 1600, 3200, 6400];
export const APERTURES = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];

// Standard full-stop shutter speeds, in seconds.
const SHUTTER_SPEEDS = [
  30, 15, 8, 4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 15, 1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500, 1 / 1000, 1 / 2000,
  1 / 4000, 1 / 8000,
];

export type ExposureSetting = {
  aperture: number;
  shutter: number; // nearest standard speed, seconds
  inRange: boolean; // false if the exact time is outside 30s..1/8000s
  handheld: boolean; // fast enough to shoot without a tripod (≤ 1/60s)
};

// Exposure equation: EV_iso = log2(N² / t), where EV_iso = EV100 + log2(ISO / 100).
export function exposureSettings(ev100: number, iso: number): ExposureSetting[] {
  const ev = ev100 + Math.log2(iso / 100);
  return APERTURES.map((aperture) => {
    const exact = (aperture * aperture) / Math.pow(2, ev);
    const shutter = SHUTTER_SPEEDS.reduce((best, s) =>
      Math.abs(Math.log2(s / exact)) < Math.abs(Math.log2(best / exact)) ? s : best,
    );
    const inRange = exact <= 30 * 1.41 && exact >= (1 / 8000) / 1.41;
    return { aperture, shutter, inRange, handheld: shutter <= 1 / 60 };
  });
}

export function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds}s`;
  return `1/${Math.round(1 / seconds)}`;
}
