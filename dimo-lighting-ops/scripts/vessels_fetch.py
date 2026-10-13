#!/usr/bin/env python3
"""Vessel positions for foreign-order sea shipments – run by the GitHub workflow "DIMO – vessel check".

Asks the database for the sailed sea shipments with the vessel's MMSI, listens to the AISstream feed
(wss://stream.aisstream.io, free, shore receivers) for those ships for a few minutes, and sends back each ship's latest
position (named by the nearest sea area or port, as in the app) with its speed, navigational status and its own reported
destination and ETA. A ship out of receiver range during the window is simply not updated this time.

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret), AISSTREAM_KEY (without it the check is skipped);
LISTEN_SECONDS (default 600). With --dry-run nothing is sent back: the readings are printed.
"""
import asyncio
import datetime as dt
import json
import math
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

import websockets

URL = 'wss://stream.aisstream.io/v0/stream'
DRY = '--dry-run' in sys.argv
NAV = {0: 'under way', 1: 'at anchor', 2: 'not under command', 3: 'restricted manoeuvrability', 4: 'constrained by draught',
       5: 'moored', 6: 'aground', 7: 'fishing', 8: 'under way sailing'}


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


def gazetteer():
    """The sea areas and ports of src/lib/places.ts, to name a point at sea the same way as the app."""
    src = (pathlib.Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'places.ts').read_text()
    out = []
    for name, start, end in (('sea', 'const SEAS', 'const norm'), ('port', 'const PORTS', 'const AIRPORTS')):
        block = src[src.index(start):src.index(end)]
        for m in re.finditer(r"\['([^']+)',\s*(-?[\d.]+),\s*(-?[\d.]+)", block):
            out.append((name, m.group(1), float(m.group(2)), float(m.group(3))))
    return out


def place_name(lat, lng, places):
    best = None
    for kind, name, plat, plng in places:
        dx = (plng - lng) * math.cos(math.radians(lat))
        d = math.hypot(plat - lat, dx) * 111
        if best is None or d < best[0]:
            best = (d, f'off {name}' if kind == 'port' else name)
    area = best[1] if best and best[0] < 900 else 'At sea'
    return f"{area} · {abs(lat):.2f}° {'S' if lat < 0 else 'N'} {abs(lng):.2f}° {'W' if lng < 0 else 'E'}"


def ais_time(meta):
    """MetaData.time_utc, e.g. '2026-10-13 06:10:21.123456789 +0000 UTC'."""
    t = (meta or {}).get('time_utc') or ''
    m = re.match(r'(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)', t)
    if not m:
        return dt.datetime.now(dt.timezone.utc).isoformat()
    return dt.datetime.fromisoformat(f'{m.group(1)}T{m.group(2)}+00:00').isoformat()


def ais_eta(e):
    """The ship's reported ETA (month, day, hour, minute in UTC, no year) as ISO, or None when not set."""
    try:
        mo, d, h, mi = int(e.get('Month') or 0), int(e.get('Day') or 0), int(e.get('Hour') or 0), int(e.get('Minute') or 0)
    except (AttributeError, TypeError, ValueError):
        return None
    if not (1 <= mo <= 12 and 1 <= d <= 31) or h > 23 or mi > 59:
        return None
    now = dt.datetime.now(dt.timezone.utc)
    year = now.year + (1 if mo < now.month - 6 else 0) - (1 if mo > now.month + 6 else 0)
    try:
        return dt.datetime(year, mo, d, h, mi, tzinfo=dt.timezone.utc).isoformat()
    except ValueError:
        return None


async def listen(mmsis, seconds):
    """Latest position and static data (destination, ETA) per MMSI heard in the window."""
    pos, static = {}, {}
    sub = {'APIKey': os.environ['AISSTREAM_KEY'], 'BoundingBoxes': [[[-90, -180], [90, 180]]], 'FiltersShipMMSI': mmsis,
           'FilterMessageTypes': ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData']}
    loop = asyncio.get_running_loop()
    end = loop.time() + seconds
    while loop.time() < end:
        try:
            async with websockets.connect(URL, open_timeout=30, ping_interval=20) as ws:
                await ws.send(json.dumps(sub))
                while loop.time() < end:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=max(1, end - loop.time()))
                    except asyncio.TimeoutError:
                        break
                    m = json.loads(raw)
                    if 'error' in m:
                        raise SystemExit(f"AISstream: {m['error']} – check the AISSTREAM_KEY secret")
                    meta = m.get('MetaData') or {}
                    mmsi = str(meta.get('MMSI') or '')
                    if mmsi not in mmsis:
                        continue
                    kind = m.get('MessageType')
                    body = (m.get('Message') or {}).get(kind) or {}
                    if kind == 'ShipStaticData':
                        static[mmsi] = {'destination': (body.get('Destination') or '').strip(' @'), 'eta': ais_eta(body.get('Eta') or {})}
                    else:
                        lat, lng = body.get('Latitude', meta.get('latitude')), body.get('Longitude', meta.get('longitude'))
                        if lat is None or lng is None or abs(lat) > 90 or abs(lng) > 180 or (lat == 0 and lng == 0):
                            continue
                        sog = body.get('Sog')
                        pos[mmsi] = {'lat': lat, 'lng': lng, 'at': ais_time(meta), 'speed': round(sog, 1) if isinstance(sog, (int, float)) and sog < 102.3 else None,
                                     'status': NAV.get(body.get('NavigationalStatus')) if kind == 'PositionReport' else None}
                    if len(pos) == len(mmsis) and len(static) == len(mmsis):
                        return pos, static
        except (OSError, websockets.exceptions.WebSocketException) as e:
            print(f'  connection: {e} – reconnecting')
            await asyncio.sleep(5)
    return pos, static


def main():
    if not os.environ.get('AISSTREAM_KEY'):
        print('No AISSTREAM_KEY secret – vessel check skipped.')
        return
    due = rpc('fo_vessels_due', {'p_secret': os.environ['FX_SECRET']}) or []
    mmsis = sorted({str(s['mmsi']) for s in due})[:50]
    print(f'{len(due)} sea shipment(s), {len(mmsis)} vessel(s) to listen for')
    if not mmsis:
        return
    pos, static = asyncio.run(listen(mmsis, int(os.environ.get('LISTEN_SECONDS') or 600)))
    places = gazetteer()
    rows = []
    for s in due:
        mmsi = str(s['mmsi'])
        p, st = pos.get(mmsi), static.get(mmsi) or {}
        if not p and not st:
            print(f"  {s['code']} {s.get('vessel') or ''} ({mmsi}): not heard")
            continue
        r = {'id': s['id'], **(p or {}), **st}
        if p:
            r['place'] = place_name(p['lat'], p['lng'], places)
        print(f"  {s['code']} {s.get('vessel') or ''} ({mmsi}): {r.get('place', 'no position')} · {r.get('status') or ''} {r.get('speed') or ''} kn · to {r.get('destination') or '?'} ETA {r.get('eta')}")
        rows.append(r)
    if rows and not DRY:
        print('Saved:', rpc('fo_vessel_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': rows}), 'new position(s)')


if __name__ == '__main__':
    # errors as GitHub annotations, so the reason shows on the run page
    try:
        main()
    except SystemExit as e:
        if e.code not in (None, 0):
            print(f'::error::{e.code}')
            sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(f'::error::{type(e).__name__}: {e}')
        raise
