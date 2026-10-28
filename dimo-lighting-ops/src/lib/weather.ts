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

/** Conditions at the moment of a live reading */
export type WeatherNow = { time: string; t: number | null; rh: number | null; p: number | null; code: number | null; w: number | null; g: number | null };

const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'precipitation_probability', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'uv_index_max'];
const CURRENT = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m'];
type Series = Record<string, (number | string | null)[] | undefined>;
const at = (s: Series, k: string, i: number) => (s[k]?.[i] ?? null) as number | null;
const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

function hoursOf(h: Series, day: string): WeatherHour[] {
  return ((h.time ?? []) as string[]).flatMap((t, i) =>
    t.startsWith(day)
      ? [{ h: Number(t.slice(11, 13)), t: r1(at(h, 'temperature_2m', i)), rh: at(h, 'relative_humidity_2m', i), p: r1(at(h, 'precipitation', i)), pp: at(h, 'precipitation_probability', i), code: at(h, 'weather_code', i), w: r1(at(h, 'wind_speed_10m', i)), g: r1(at(h, 'wind_gusts_10m', i)) }]
      : [],
  );
}
function dayOf(d: Series, day: string): WeatherDay | null {
  const i = ((d.time ?? []) as string[]).indexOf(day);
  if (i < 0) return null;
  const hm = (k: string) => (((d[k]?.[i] as string | null) ?? '').slice(11, 16) || null);
  return { code: at(d, 'weather_code', i), tmax: r1(at(d, 'temperature_2m_max', i)), tmin: r1(at(d, 'temperature_2m_min', i)), rain_mm: r1(at(d, 'precipitation_sum', i)), rain_prob: at(d, 'precipitation_probability_max', i), wind_max: r1(at(d, 'wind_speed_10m_max', i)), gust_max: r1(at(d, 'wind_gusts_10m_max', i)), uv_max: r1(at(d, 'uv_index_max', i)), sunrise: hm('sunrise'), sunset: hm('sunset') };
}

/** The weather at the site as at now, read straight from Open-Meteo (the same figures as the 19:00 record) – shown, not saved */
export async function liveWeather(exec: string, lat: number, lng: number): Promise<SiteWeather & { now: WeatherNow }> {
  const q = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lng.toFixed(4), hourly: HOURLY.join(','), daily: DAILY.join(','), current: CURRENT.join(','), timezone: 'Asia/Colombo', forecast_days: '2', wind_speed_unit: 'kmh' });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`The weather service did not answer (${res.status}) – try again in a minute`);
  const data = (await res.json()) as { hourly: Series; daily: Series; current: Record<string, number | string | null> };
  const days = (data.daily.time ?? []) as string[];
  const [today, tomorrow] = days;
  const hours = hoursOf(data.hourly, today);
  const work = hours.filter((x) => x.h >= WORK_FROM && x.h <= WORK_TO);
  const rh = hours.map((x) => x.rh).filter((v): v is number => v != null);
  const temps = work.map((x) => x.t).filter((v): v is number => v != null);
  const summary: WeatherDay = {
    ...(dayOf(data.daily, today) as WeatherDay),
    rh_avg: rh.length ? Math.round(rh.reduce((a, b) => a + b, 0) / rh.length) : null,
    work_rain_mm: r1(work.reduce((a, x) => a + (x.p ?? 0), 0)),
    work_rain_hours: work.filter((x) => (x.p ?? 0) >= 0.5).length,
    work_tmax: temps.length ? Math.max(...temps) : null,
  };
  const t = tomorrow ? dayOf(data.daily, tomorrow) : null;
  const c = data.current;
  return {
    exec_project_id: exec, day: today, lat, lng, summary, hours,
    tomorrow: t && tomorrow ? { ...t, day: tomorrow, hours: hoursOf(data.hourly, tomorrow) } : null,
    source: 'Open-Meteo (live)', fetched_at: new Date().toISOString(),
    now: { time: String(c.time ?? ''), t: r1(c.temperature_2m as number | null), rh: c.relative_humidity_2m as number | null, p: r1(c.precipitation as number | null), code: c.weather_code as number | null, w: r1(c.wind_speed_10m as number | null), g: r1(c.wind_gusts_10m as number | null) },
  };
}
