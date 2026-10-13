#!/usr/bin/env python3
"""Sri Lanka public holidays for the working-day clocks – run every week by the GitHub workflow "DIMO – holidays".

Two sources, merged by date (a day in either is a holiday):
* the open-source "holidays" register (https://github.com/vacanza/holidays), which follows the Government gazette
  (Poya days, Sinhala and Tamil New Year, Eid, Diwali, …), and
* the public Sri Lanka holiday calendar from Google (public holidays only – observances are left out), which usually has
  the next year's gazette first.
Only this year and next are sent. A year is sent as complete (old automatic dates removed) when it has 20+ days.

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret). With --dry-run nothing is sent.
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
ICS = 'https://calendar.google.com/calendar/ical/en.lk%23holiday%40group.v.calendar.google.com/public/basic.ics'
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


def from_register(years):
    try:
        import holidays
    except ImportError:
        print('holidays register not installed')
        return {}
    out = {}
    for y in years:
        try:
            for d, n in holidays.country_holidays('LK', years=y, language='en_US').items():
                out[d.isoformat()] = n
        except Exception as e:  # noqa: BLE001 – a missing year is not an error
            print(f'register {y}: {e}')
    return out


def from_google(years):
    try:
        req = urllib.request.Request(ICS, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        print(f'Google calendar not reachable: {e}')
        return {}
    text = re.sub(r'\r?\n[ \t]', '', text)  # unfold long lines
    out = {}
    for ev in text.split('BEGIN:VEVENT')[1:]:
        m = re.search(r'^DTSTART;VALUE=DATE:(\d{8})', ev, re.M)
        s = re.search(r'^SUMMARY:(.*)$', ev, re.M)
        desc = (re.search(r'^DESCRIPTION:(.*)$', ev, re.M) or [None, ''])[1]
        if not m or not s or 'observance' in desc.lower():
            continue
        if 'holiday' not in desc.lower():
            continue
        d = dt.datetime.strptime(m.group(1), '%Y%m%d').date()
        if d.year in years:
            out[d.isoformat()] = s.group(1).replace('\\,', ',').strip()
    return out


def main():
    this = dt.date.today().year
    years = [this, this + 1]
    reg = from_register(years)
    goo = from_google(years)
    days = dict(goo)
    days.update(reg)  # the register's names win where both have the day
    rows = [{'day': d, 'name': n} for d, n in sorted(days.items())]
    complete = [y for y in years if sum(1 for r in rows if r['day'].startswith(str(y))) >= 20]
    for y in years:
        print(f'{y}: {sum(1 for r in rows if r["day"].startswith(str(y)))} days (register {sum(1 for d in reg if d.startswith(str(y)))}, '
              f'Google {sum(1 for d in goo if d.startswith(str(y)))}){" – complete" if y in complete else ""}')
    if DRY:
        for r in rows:
            print(r['day'], r['name'])
        return
    if not rows:
        raise SystemExit('No holidays found in either source')
    print(rpc('holidays_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': rows, 'p_years': complete}))


if __name__ == '__main__':
    main()
