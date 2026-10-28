#!/usr/bin/env python3
"""Site weather for the daily reports – run by the GitHub workflow "DIMO – site weather" every day at 19:00 Sri Lanka time.

For each active execution project with a location it reads Open-Meteo (https://open-meteo.com, free, no key) at the site and
records the day's weather profile hour by hour with the day's summary, and the forecast for the next day. On the first run
(or with BACKFILL_DAYS) the past days are loaded too, so earlier daily reports get their weather.

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret); BACKFILL_DAYS (default 0, at most 92).
With --dry-run nothing is sent: the readings are printed. With --sample FILE an Open-Meteo reply saved in FILE is used.
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

DRY = '--dry-run' in sys.argv
SAMPLE = sys.argv[sys.argv.index('--sample') + 1] if '--sample' in sys.argv else None
TZ = 'Asia/Colombo'
WORK = range(7, 19)  # site working hours 07:00–18:59
HOURLY = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'precipitation_probability', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m']
DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max',
         'wind_speed_10m_max', 'wind_gusts_10m_max', 'sunrise', 'sunset', 'uv_index_max']


def rpc(fn, args):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/rpc/' + fn
    key = os.environ['SUPABASE_ANON_KEY']
    req = urllib.request.Request(url, data=json.dumps(args).encode(), method='POST',
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{fn}: HTTP {e.code} {e.read().decode()[:500]}')


def meteo(lat, lng, past_days):
    if SAMPLE:
        with open(SAMPLE) as f:
            return json.load(f)
    q = urllib.parse.urlencode({'latitude': f'{lat:.4f}', 'longitude': f'{lng:.4f}', 'hourly': ','.join(HOURLY), 'daily': ','.join(DAILY),
                                'timezone': TZ, 'past_days': past_days, 'forecast_days': 2, 'wind_speed_unit': 'kmh'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen('https://api.open-meteo.com/v1/forecast?' + q, timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001 – network hiccups: try again
            if attempt == 3:
                raise
            print(f'  retry after {e}')
            time.sleep(4 * (attempt + 1))


def num(v, d=1):
    if v is None:
        return None
    return int(round(float(v))) if d == 0 else round(float(v), d)


def hours_of(data, day):
    """[{h, t, rh, p, pp, code, w, g}] for one day from the hourly series"""
    h = data.get('hourly') or {}
    out = []
    for i, t in enumerate(h.get('time') or []):
        if not t.startswith(day):
            continue
        g = lambda k, d=1: num((h.get(k) or [None] * (i + 1))[i], d)  # noqa: E731
        out.append({'h': int(t[11:13]), 't': g('temperature_2m'), 'rh': g('relative_humidity_2m', 0), 'p': g('precipitation'),
                    'pp': g('precipitation_probability', 0), 'code': g('weather_code', 0), 'w': g('wind_speed_10m'), 'g': g('wind_gusts_10m')})
    return out


def daily_of(data, day):
    d = data.get('daily') or {}
    times = d.get('time') or []
    if day not in times:
        return None
    i = times.index(day)
    g = lambda k, n=1: num((d.get(k) or [None] * (i + 1))[i], n)  # noqa: E731
    s = lambda k: ((d.get(k) or [None] * (i + 1))[i] or '')[11:16] or None  # noqa: E731
    return {'code': g('weather_code', 0), 'tmax': g('temperature_2m_max'), 'tmin': g('temperature_2m_min'), 'rain_mm': g('precipitation_sum'),
            'rain_prob': g('precipitation_probability_max', 0), 'wind_max': g('wind_speed_10m_max'), 'gust_max': g('wind_gusts_10m_max'),
            'uv_max': g('uv_index_max'), 'sunrise': s('sunrise'), 'sunset': s('sunset')}


def summary_of(data, day):
    s = daily_of(data, day)
    hs = hours_of(data, day)
    if not s or not hs:
        return None, hs
    work = [x for x in hs if x['h'] in WORK]
    rh = [x['rh'] for x in hs if x['rh'] is not None]
    s['rh_avg'] = round(sum(rh) / len(rh)) if rh else None
    s['work_rain_mm'] = round(sum(x['p'] or 0 for x in work), 1)
    s['work_rain_hours'] = sum(1 for x in work if (x['p'] or 0) >= 0.5)
    s['work_tmax'] = max((x['t'] for x in work if x['t'] is not None), default=None)
    return s, hs


def main():
    backfill = max(0, min(92, int(os.environ.get('BACKFILL_DAYS') or 0)))
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
    sites = [{'id': 'sample', 'name': 'Sample site', 'lat': 6.9271, 'lng': 79.8612}] if SAMPLE and DRY else rpc('weather_sites', {'p_secret': os.environ['FX_SECRET']})
    print(f'{len(sites)} site(s) with a location; today {today}; back-fill {backfill} day(s)')
    rows = []
    for s in sites:
        data = meteo(s['lat'], s['lng'], max(1, backfill))
        start = dt.date.fromisoformat(s['start']) if s.get('start') else None
        days = [today - dt.timedelta(days=k) for k in range(backfill, -1, -1)]
        tomorrow = (today + dt.timedelta(days=1)).isoformat()
        for d in days:
            if start and d < start:
                continue
            summary, hs = summary_of(data, d.isoformat())
            if not summary:
                continue
            row = {'exec': s['id'], 'day': d.isoformat(), 'lat': s['lat'], 'lng': s['lng'], 'summary': summary, 'hours': hs, 'tomorrow': None}
            if d == today:
                t = daily_of(data, tomorrow)
                if t:
                    row['tomorrow'] = {'day': tomorrow, **t, 'hours': hours_of(data, tomorrow)}
            rows.append(row)
        print(f"  {s['name']}: {sum(1 for r in rows if r['exec'] == s['id'])} day(s)")
    if DRY:
        print(json.dumps(rows[-1:] if rows else [], indent=1)[:4000])
        return
    for i in range(0, len(rows), 200):
        n = rpc('weather_ingest', {'p_secret': os.environ['FX_SECRET'], 'p_rows': rows[i:i + 200]})
        print(f'  saved {n}')


if __name__ == '__main__':
    main()
