import { Text, View } from 'react-native';
import { Card, colors, Muted, Row } from '@/components/ui';
import { fmtDate, fmtDateTimeY } from '@/lib/format';
import { condition, impacts, PROFILE_HOURS, rainText, round1, symbol, temps, windText, WORK_FROM, WORK_TO, type SiteWeather, type WeatherDay, type WeatherHour } from '@/lib/weather';

const RAIN = '#2A6BC7';
const TEMP = colors.red;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 120, flexGrow: 1, flexBasis: 120, gap: 2 }}>
      <Muted style={{ fontSize: 11 }}>{label}</Muted>
      <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

/** Hour columns: temperature on top, rain as a blue bar, hour and chance of rain below; working hours shaded */
export function HourProfile({ hours }: { hours: WeatherHour[] }) {
  const hs = PROFILE_HOURS.map((h) => hours.find((x) => x.h === h)).filter((x): x is WeatherHour => !!x);
  if (!hs.length) return <Muted>No hourly readings.</Muted>;
  const pmax = Math.max(2, ...hs.map((x) => x.p ?? 0));
  const ts = hs.map((x) => x.t).filter((v): v is number => v != null);
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {hs.map((x) => {
          const work = x.h >= WORK_FROM && x.h <= WORK_TO;
          const tPos = x.t == null || tmax === tmin ? 0.5 : (x.t - tmin) / (tmax - tmin);
          return (
            <View key={x.h} style={{ flex: 1, alignItems: 'center', backgroundColor: work ? colors.soft : 'transparent', borderRadius: 4, paddingVertical: 4 }}>
              <View style={{ height: 34, justifyContent: 'flex-end' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: TEMP, marginBottom: tPos * 18 }}>{x.t == null ? '' : `${Math.round(x.t)}°`}</Text>
              </View>
              <View style={{ height: 56, width: '70%', justifyContent: 'flex-end', alignItems: 'center' }}>
                {x.p ? <Text style={{ fontSize: 10, color: RAIN, fontWeight: '700' }}>{round1(x.p)}</Text> : null}
                <View style={{ width: '100%', height: Math.max(x.p ? 3 : 1, ((x.p ?? 0) / pmax) * 40), backgroundColor: x.p ? RAIN : colors.line, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              </View>
              <Text style={{ fontSize: 11, color: colors.ink, fontWeight: '600', marginTop: 3 }}>{String(x.h).padStart(2, '0')}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>{x.pp == null ? '' : `${x.pp}%`}</Text>
            </View>
          );
        })}
      </View>
      <Muted style={{ fontSize: 11 }}>Temperature °C (red), rain mm in the hour (blue bars), chance of rain under each hour. Shaded: working hours 07:00–18:00.</Muted>
    </View>
  );
}

function Impacts({ d, hours }: { d: WeatherDay; hours?: WeatherHour[] }) {
  return (
    <View style={{ gap: 4 }}>
      {impacts(d, hours).map((x) => (
        <Row key={x.text} gap={6} style={{ alignItems: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: x.level === 'stop' ? colors.red : x.level === 'warn' ? colors.amber : colors.green }} />
          <Text style={{ color: colors.text, flex: 1 }}>{x.text}</Text>
        </Row>
      ))}
    </View>
  );
}

/** The recorded weather of one day at the site: summary, hour-by-hour profile, what it meant for work, and the next day's forecast */
export function WeatherCard({ w, title, showTomorrow = true, live }: { w: SiteWeather; title?: string; showTomorrow?: boolean; live?: boolean }) {
  const d = w.summary;
  const t = w.tomorrow;
  return (
    <Card style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} wrap gap={8}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 16 }}>{title ?? `Weather on site · ${fmtDate(w.day)}`}</Text>
          <Muted style={{ fontSize: 12 }}>{`${live ? 'Fetched now' : 'Recorded automatically'} ${fmtDateTimeY(w.fetched_at)} · ${w.source} at ${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}${live ? ' · not saved – the day is recorded at 19:00' : ''}`}</Muted>
        </View>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 28 }}>{symbol(d.code)}</Text>
          <View>
            <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 15 }}>{condition(d.code)}</Text>
            <Text style={{ color: colors.text }}>{temps(d)}</Text>
          </View>
        </Row>
      </Row>
      <Row wrap gap={10}>
        <Stat label="Rain (day)" value={rainText(d)} />
        <Stat label="Rain in working hours" value={d.work_rain_mm == null ? '—' : `${round1(d.work_rain_mm)} mm · ${d.work_rain_hours ?? 0} h`} />
        <Stat label="Wind" value={windText(d)} />
        <Stat label="Humidity (average)" value={d.rh_avg == null ? '—' : `${d.rh_avg}%`} />
        <Stat label="UV index (max)" value={d.uv_max == null ? '—' : String(round1(d.uv_max))} />
        <Stat label="Sunrise / sunset" value={d.sunrise && d.sunset ? `${d.sunrise} / ${d.sunset}` : '—'} />
      </Row>
      <HourProfile hours={w.hours} />
      <Impacts d={d} hours={w.hours} />
      {showTomorrow && t ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 4 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`Forecast for ${fmtDate(t.day)}: ${symbol(t.code)} ${condition(t.code)}`}</Text>
          <Text style={{ color: colors.text }}>{`${temps(t)} · rain ${rainText(t)} · wind ${windText(t)}`}</Text>
          {impacts(t, t.hours ?? []).filter((x) => x.level !== 'info').map((x) => <Muted key={x.text}>{`Expect: ${x.text}`}</Muted>)}
        </View>
      ) : null}
    </Card>
  );
}
