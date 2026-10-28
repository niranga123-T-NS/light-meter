import { useState } from 'react';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { colors, Loading, Muted, Notice, Section } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { condition, impacts, rainText, round1, symbol, temps, type SiteWeather } from '@/lib/weather';
import { WeatherCard } from './WeatherCard';

/** Daily reports › Weather: the site weather recorded every evening at 19:00 – the chosen day in full and the days before */
export function WeatherTab({ p }: { p: ExecProject }) {
  const [pick, setPick] = useState<string | null>(null);
  const { data } = useLoad(async () => {
    const { data: w } = await supabase.from('exec_weather').select('*').eq('exec_project_id', p.id).order('day', { ascending: false }).limit(90);
    return (w ?? []) as SiteWeather[];
  }, [p.id]);
  if (!data) return <Loading />;
  const located = p.site_lat != null || p.lat != null;
  const chosen = data.find((w) => w.day === pick) ?? data[0] ?? null;
  return (
    <View style={{ gap: 12 }}>
      <Muted>The weather at the site is recorded automatically every day at 19:00 – the day hour by hour and the forecast for the next day – and added to the daily reports of that date (screen and PDF).</Muted>
      {!located && !data.length ? (
        <Notice tone={colors.amber}>The site location is not set yet, so no weather can be read. The Senior Electrical Engineer sets it under Overview › Site location (GPS).</Notice>
      ) : null}
      {located && !data.length ? <Notice tone={colors.blue}>Nothing recorded yet – the first reading is made at 19:00 today.</Notice> : null}
      {chosen ? <WeatherCard w={chosen} title={`Weather on site · ${fmtDate(chosen.day)}`} /> : null}
      {data.length ? (
        <Section title="Day by day">
          <DataTable
            rows={data}
            keyOf={(w) => w.day}
            onPress={(w) => setPick(w.day)}
            edge={(w) => {
              const l = impacts(w.summary, w.hours).map((x) => x.level);
              return l.includes('stop') ? colors.red : l.includes('warn') ? colors.amber : undefined;
            }}
            columns={[
              { h: 'Date', w: 110, bold: true, v: (w) => fmtDate(w.day) },
              { h: 'Weather', w: 160, v: (w) => <Text style={{ color: colors.text }}>{`${symbol(w.summary.code)} ${condition(w.summary.code)}`}</Text> },
              { h: 'Temperature', w: 100, v: (w) => temps(w.summary) },
              { h: 'Rain (day)', w: 140, v: (w) => rainText(w.summary) },
              { h: 'Rain 07–18 h', w: 100, right: true, v: (w) => (w.summary.work_rain_mm == null ? '—' : `${round1(w.summary.work_rain_mm)} mm`) },
              { h: 'Gusts', w: 80, right: true, v: (w) => (w.summary.gust_max == null ? '—' : `${Math.round(w.summary.gust_max)} km/h`) },
              { h: 'Effect on site work', w: 320, grow: true, v: (w) => impacts(w.summary, w.hours).map((x) => x.text).join(' · ') },
            ]}
          />
        </Section>
      ) : null}
    </View>
  );
}
