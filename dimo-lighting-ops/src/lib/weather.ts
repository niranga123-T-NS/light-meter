import { supabase } from './supabase';

/** Site weather recorded every day at 19:00 by the GitHub workflow "DIMO – site weather" (Open-Meteo) */
export type WeatherHour = { h: number; t: number | null; rh: number | null; p: number | null; pp: number | null; code: number | null; w: number | null; g: number | null };
export type WeatherDay = {
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  rain_mm: number | null;
  rain_prob: number | null;
  wind_max: number | null;
  gust_max: number | null;
  uv_max?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
  rh_avg?: number | null;
  work_rain_mm?: number | null;
  work_rain_hours?: number | null;
  work_tmax?: number | null;
};
export type SiteWeather = {
  exec_project_id: string;
  day: string;
  lat: number;
  lng: number;
  summary: WeatherDay;
  hours: WeatherHour[];
  tomorrow: (WeatherDay & { day: string; hours?: WeatherHour[] }) | null;
  source: string;
  fetched_at: string;
};

/** The hours shown in the profile: 06:00 to 19:00 */
export const PROFILE_HOURS = Array.from({ length: 14 }, (_, i) => i + 6);
export const WORK_FROM = 7, WORK_TO = 18;

/** WMO weather code → words */
export function condition(code: number | null | undefined) {
  if (code == null) return '—';
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61) return 'Light rain';
  if (code === 63) return 'Rain';
  if (code === 65) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code === 80) return 'Light showers';
  if (code === 81) return 'Showers';
  if (code === 82) return 'Violent showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code >= 96) return 'Thunderstorm with hail';
  return 'Mixed';
}

/** A short symbol for the condition (plain text so it prints everywhere) */
export function symbol(code: number | null | undefined) {
  if (code == null) return '·';
  if (code <= 1) return '☀';
  if (code <= 3) return '⛅';
  if (code === 45 || code === 48) return '≋';
  if (code >= 95) return '⚡';
  return '☂';
}

export type Impact = { text: string; level: 'stop' | 'warn' | 'info' };

/** What the day's weather meant for site work (working hours 07:00–18:00) */
export function impacts(d: WeatherDay, hours: WeatherHour[] = []): Impact[] {
  const out: Impact[] = [];
  const work = hours.filter((x) => x.h >= WORK_FROM && x.h <= WORK_TO);
  const wet = d.work_rain_mm ?? work.reduce((t, x) => t + (x.p ?? 0), 0);
  const wetHours = d.work_rain_hours ?? work.filter((x) => (x.p ?? 0) >= 0.5).length;
  const storm = (d.code ?? 0) >= 95 || work.some((x) => (x.code ?? 0) >= 95);
  if (storm) out.push({ text: 'Thunderstorm – outdoor electrical work, work at height and lifting to stop while it lasts', level: 'stop' });
  if (wet >= 10 || work.some((x) => (x.p ?? 0) >= 5)) out.push({ text: `Heavy rain in working hours (${round1(wet)} mm) – outdoor work likely stopped`, level: 'stop' });
  else if (wetHours >= 1) out.push({ text: `Rain in working hours – ${wetHours} hour${wetHours > 1 ? 's' : ''}, ${round1(wet)} mm`, level: 'warn' });
  if ((d.gust_max ?? 0) >= 40) out.push({ text: `Strong gusts up to ${Math.round(d.gust_max!)} km/h – lifting and work at height restricted`, level: 'warn' });
  const hot = d.work_tmax ?? d.tmax;
  if ((hot ?? 0) >= 33) out.push({ text: `Hot – up to ${Math.round(hot!)} °C; plan water and shade breaks`, level: 'warn' });
  if (!out.length) out.push({ text: 'No weather limits on site work', level: 'info' });
  return out;
}

export const round1 = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n * 10) / 10));
export const temps = (d: WeatherDay) => (d.tmin == null || d.tmax == null ? '—' : `${Math.round(d.tmin)}–${Math.round(d.tmax)} °C`);
export const rainText = (d: WeatherDay) => `${round1(d.rain_mm)} mm${d.rain_prob != null ? ` · ${d.rain_prob}% chance` : ''}`;
export const windText = (d: WeatherDay) => (d.wind_max == null ? '—' : `${Math.round(d.wind_max)} km/h${d.gust_max != null ? `, gusts ${Math.round(d.gust_max)}` : ''}`);
/** One line for a day, e.g. "Rain · 24–30 °C · rain 7.5 mm (80%) · wind 14 km/h, gusts 32" */
export const oneLine = (d: WeatherDay) => `${condition(d.code)} · ${temps(d)} · rain ${rainText(d)} · wind ${windText(d)}`;

/** The recorded weather of a project on a day (null when not recorded yet) */
export async function weatherOn(exec: string, day: string) {
  const { data } = await supabase.from('exec_weather').select('*').eq('exec_project_id', exec).eq('day', day).maybeSingle();
  return (data as SiteWeather | null) ?? null;
}
