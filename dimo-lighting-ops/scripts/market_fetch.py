#!/usr/bin/env python3
"""Market prices for the Home dashboards – run by the GitHub workflow "DIMO – market prices".

* Copper and aluminium: LME official cash settlement (USD per tonne), as published each London business day on
  Westmetall (https://www.westmetall.com/en/markdaten.php).
* Steel: Shanghai Futures Exchange hot-rolled coil (HC, main contract) and PVC: Dalian Commodity Exchange PVC (V, main
  contract) – CNY per tonne (Chinese VAT included) from the Sina finance daily series; converted to USD with the day's
  ECB USD/CNY rate (Frankfurter). They follow the Platts steel and PVC assessments but are not the Platts figures.

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret); BACKFILL_DAYS (first run, default 400).
With --dry-run nothing is sent: the readings are printed.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
DRY = '--dry-run' in sys.argv
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'])}


def get(url, referer=None):
    headers = {'User-Agent': UA}
    if referer:
        headers['Referer'] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace')


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


def lme(field, since):
    """{date: USD per tonne} – the LME cash settlement from Westmetall's table (newest first, one table per year)"""
    page = get(f'https://www.westmetall.com/en/markdaten.php?action=table&field={field}')
    out = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, flags=re.S | re.I):
        cells = [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.S | re.I)]
        if len(cells) < 2:
            continue
        m = re.match(r'(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{4})', cells[0])
        if not m or m.group(2).lower() not in MONTHS:
            continue
        d = dt.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
        try:
            v = float(cells[1].replace(',', ''))
        except ValueError:
            continue
        if d >= since and v > 0:
            out[d.isoformat()] = v
    return out


def sina(symbol, since):
    """{date: CNY per tonne} – the daily close of a Chinese futures main contract"""
    txt = get(f'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_{symbol}=/InnerFuturesNewService.getDailyKLine?symbol={symbol}',
              referer='https://finance.sina.com.cn/')
    m = re.search(r'\((\[.*\])\)', txt, flags=re.S)
    if not m:
        raise ValueError(f'{symbol}: no data in the reply ({txt[:120]!r})')
    out = {}
    for r in json.loads(m.group(1)):
        d, c = r.get('d'), r.get('c')
        if d and c and d >= since.isoformat() and float(c) > 0:
            out[d[:10]] = float(c)
    return out


def usd_cny(since):
    """{date: CNY per USD} (ECB reference rates, working days)"""
    data = json.loads(get(f'https://api.frankfurter.dev/v1/{since.isoformat()}..?base=USD&symbols=CNY'))
    return {d: v['CNY'] for d, v in data.get('rates', {}).items() if v.get('CNY')}


def main():
    today = dt.date.today()
    last = {} if DRY else (rpc('market_last_dates', {'p_secret': os.environ['FX_SECRET']}) or {})
    back = int(os.environ.get('BACKFILL_DAYS') or 400)

    def since(item):
        return (dt.date.fromisoformat(last[item]) - dt.timedelta(days=7)) if last.get(item) else today - dt.timedelta(days=back)

    rows, problems = [], []
    for item, field in (('copper', 'LME_Cu_cash'), ('aluminium', 'LME_Al_cash')):
        try:
            got = lme(field, since(item))
            rows += [{'item': item, 'date': d, 'price': v, 'currency': 'USD', 'usd': v} for d, v in got.items()]
            print(f'::notice::{item}: {len(got)} day(s), latest {max(got) if got else None} {got.get(max(got)) if got else ""} USD/t')
        except Exception as e:  # noqa: BLE001 – the other prices still go in
            problems.append(f'{item}: {e}')
    try:
        fx = usd_cny(min(since('steel_hrc'), since('pvc')) - dt.timedelta(days=10))
        fx_days = sorted(fx)
    except Exception as e:  # noqa: BLE001
        fx, fx_days = {}, []
        problems.append(f'USD/CNY: {e}')
    for item, symbol in (('steel_hrc', 'HC0'), ('pvc', 'V0')):
        if not fx:
            break
        try:
            got = sina(symbol, since(item))
            n = 0
            for d, v in got.items():
                k = max((x for x in fx_days if x <= d), default=None)  # the rate of that day, else the last before it
                if k is None:
                    continue
                rows.append({'item': item, 'date': d, 'price': v, 'currency': 'CNY', 'usd': round(v / fx[k], 2), 'fx': fx[k]})
                n += 1
            last_row = rows[-1] if n else {}
            print(f'::notice::{item}: {n} day(s), latest {last_row.get("date")} {last_row.get("price")} CNY/t = {last_row.get("usd")} USD/t (USD/CNY {last_row.get("fx")})')
        except Exception as e:  # noqa: BLE001
            problems.append(f'{item}: {e}')
    for p in problems:
        print(f'::warning::{p}')
    if DRY:
        print(json.dumps(rows[-12:], indent=1))
    elif rows:
        print('Saved:', rpc('market_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': {'rows': rows}}))
    if not rows:
        raise SystemExit('No prices could be read')


if __name__ == '__main__':
    main()
