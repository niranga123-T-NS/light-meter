#!/usr/bin/env python3
"""Flight status for foreign-order air shipments – run by the GitHub workflow "DIMO – flight check".

Asks the database for the air shipments to check (flight no. and ETD, not landed), looks each flight up on AeroDataBox
(RapidAPI, flight status by number and departure date) and sends back the status, departed / expected / landed times and
the airports. The database records them on the shipment, moves the ETA, marks the airports on the map and tells Ops,
Sales and the SEE (departed, delayed, cancelled / diverted, landed).

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret), AERODATABOX_KEY (RapidAPI key; without it the
check is skipped). With --dry-run nothing is sent back: the readings are printed.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

HOST = 'aerodatabox.p.rapidapi.com'
DRY = '--dry-run' in sys.argv


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


def lookup(flight, date):
    """The flights with this number departing on this (local) date; [] when none is known."""
    url = f'https://{HOST}/flights/number/{flight}/{date}?withAircraftImage=false&withLocation=false&dateLocalRole=Departure'
    req = urllib.request.Request(url, headers={'X-RapidAPI-Key': os.environ['AERODATABOX_KEY'], 'X-RapidAPI-Host': HOST, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return json.loads(body) if body.strip() else []
    except urllib.error.HTTPError as e:
        if e.code in (204, 404):
            return []
        if e.code in (401, 403):
            raise SystemExit(f'AeroDataBox refused the key (HTTP {e.code}) – check the AERODATABOX_KEY secret and the RapidAPI subscription')
        if e.code == 429:
            raise SystemExit('AeroDataBox: the monthly allowance is used up (HTTP 429)')
        print(f'  {flight} {date}: HTTP {e.code} {e.read().decode()[:200]}')
        return None


def when(t):
    """A time from AeroDataBox ({"utc": "2026-10-13 06:10Z", "local": ...} or a plain string) as ISO UTC, else None."""
    if isinstance(t, dict):
        t = t.get('utc') or t.get('local')
    if not isinstance(t, str) or not t.strip():
        return None
    s = t.strip().replace(' ', 'T')
    s = re.sub(r'Z$', '+00:00', s)
    try:
        d = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(dt.timezone.utc).isoformat()


def first(leg, *keys):
    for k in keys:
        v = when(leg.get(k))
        if v:
            return v
    return None


def airport(leg):
    a = leg.get('airport') or {}
    loc = a.get('location') or {}
    return a.get('iata') or a.get('icao') or '', a.get('shortName') or a.get('municipalityName') or a.get('name') or '', loc.get('lat'), loc.get('lon')


def reading(s, f):
    dep, arr = f.get('departure') or {}, f.get('arrival') or {}
    status = f.get('status') or ''
    d_iata, d_name, d_lat, d_lng = airport(dep)
    a_iata, a_name, a_lat, a_lng = airport(arr)
    departed = first(dep, 'runwayTime', 'actualTime')
    if not departed and status in ('Departed', 'EnRoute', 'Approaching', 'Arrived'):
        departed = first(dep, 'revisedTime', 'scheduledTime')
    landed = first(arr, 'runwayTime', 'actualTime')
    if not landed and status == 'Arrived':
        landed = first(arr, 'revisedTime', 'predictedTime', 'scheduledTime')
    return {
        'id': s['id'], 'status': status,
        'dep_iata': d_iata, 'dep_name': d_name, 'dep_lat': d_lat, 'dep_lng': d_lng,
        'arr_iata': a_iata, 'arr_name': a_name, 'arr_lat': a_lat, 'arr_lng': a_lng,
        'departed_at': departed, 'arrival_at': first(arr, 'predictedTime', 'revisedTime', 'scheduledTime'), 'landed_at': landed,
    }


def main():
    if not os.environ.get('AERODATABOX_KEY'):
        print('No AERODATABOX_KEY secret – flight check skipped.')
        return
    due = rpc('fo_flights_due', {'p_secret': os.environ['FX_SECRET']}) or []
    print(f'{len(due)} air shipment(s) to check')
    rows = []
    for s in due:
        flights = lookup(s['flight'], s['date'])
        if flights is None:
            continue
        if isinstance(flights, dict):
            flights = [flights]
        if not flights:
            print(f"  {s['code']} {s['flight']} {s['date']}: not found")
            continue
        # a multi-leg flight number: the leg going to Sri Lanka, else the first leg
        f = next((x for x in flights if ((x.get('arrival') or {}).get('airport') or {}).get('countryCode') == 'LK'), flights[0])
        r = reading(s, f)
        print(f"  {s['code']} {s['flight']}: {r['status']} {r['dep_iata']} → {r['arr_iata']} departed {r['departed_at']} arrival {r['arrival_at']} landed {r['landed_at']}")
        rows.append(r)
    if rows and not DRY:
        print('Saved:', rpc('fo_flight_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': rows}))


if __name__ == '__main__':
    main()
