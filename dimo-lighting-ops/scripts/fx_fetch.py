#!/usr/bin/env python3
"""Exchange rates for the Home dashboards – run by the GitHub workflow "DIMO – exchange rates".

* Central Bank of Sri Lanka daily indicative rates (USD, EUR, GBP in LKR) through the open Frankfurter service
  (https://frankfurter.dev/providers/cbsl/) – the CBSL website refuses servers outside Sri Lanka.
* Sri Lanka Customs weekly schedule: the newest "Effective from" PDF on https://www.customs.gov.lk/exchange-rates/ is a
  scanned image, read with OCR (tesseract); the database refuses a reading far from the Central Bank rate.

Env: SUPABASE_URL, SUPABASE_ANON_KEY, FX_SECRET (the dispatch secret); BACKFILL_DAYS (first run, default 400).
With --dry-run nothing is sent: the readings are printed (used to check the OCR).
"""
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
CCY = ('USD', 'EUR', 'GBP')
DRY = '--dry-run' in sys.argv


def get(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', 'replace')


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


def cbsl(since):
    """{date: {USD: x, EUR: y, GBP: z}} – LKR per unit, from `since`"""
    out = {}
    for c in CCY:
        rows = json.loads(get(f'https://api.frankfurter.dev/v2/rates?from={since}&providers=CBSL&base={c}&quotes=LKR'))
        for r in rows:
            if r.get('quote') == 'LKR' and r.get('rate'):
                out.setdefault(r['date'], {})[c] = round(float(r['rate']), 4)
    return out


def dmy(s):
    d, m, y = re.split(r'[./-]', s)
    return dt.date(int(y), int(m), int(d)).isoformat()


def customs_latest():
    """(effective_from, pdf_url) of the newest schedule listed on the Customs website"""
    page = get('https://www.customs.gov.lk/exchange-rates/')
    found = []
    for href, text in re.findall(r'href="([^"]+\.pdf)"[^>]*>(.*?)</a>', page, flags=re.S | re.I):
        m = re.search(r'Effective\s+from\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4})', re.sub(r'<[^>]+>', ' ', text), re.I)
        if m:
            found.append((dmy(m.group(1)), href))
    return max(found) if found else (None, None)


def page_images(data, tmp):
    """The scanned pages of the PDF (full resolution), else the rendered pages"""
    pdf = os.path.join(tmp, 'er.pdf')
    open(pdf, 'wb').write(data)
    subprocess.run(['pdfimages', '-all', pdf, os.path.join(tmp, 'img')], check=True)
    imgs = [i for i in sorted(glob.glob(os.path.join(tmp, 'img-*'))) if os.path.getsize(i) > 100_000]
    if not imgs:
        subprocess.run(['pdftoppm', '-r', '300', '-png', pdf, os.path.join(tmp, 'page')], check=True)
        imgs = sorted(glob.glob(os.path.join(tmp, 'page*.png')))
    return imgs


def tess(img, *args):
    return subprocess.run(['tesseract', img, '-', *args], capture_output=True, text=True).stdout


NUM = re.compile(r'(\d[\d,\s]*[.,]\s?\d{4})(?!\d)')
NAMES = {'USD': ('usd', 'us dollar', 'usa'), 'EUR': ('eur',), 'GBP': ('gbp', 'sterling', 'united kingdom')}


def to_num(v):
    v = re.sub(r'[\s,]', '', v[:-5]) + '.' + v[-4:]
    return float(v.replace('..', '.'))


def ocr_texts(data):
    """OCR of the schedule page in a few ways (plain, enlarged grey, black-and-white, column mode) – each misreads different digits"""
    from PIL import Image, ImageOps
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        for img in page_images(data, tmp):
            out.append(tess(img, '--psm', '6'))
            g = ImageOps.autocontrast(Image.open(img).convert('L'), cutoff=1)
            g = g.resize((g.width * 2, g.height * 2), Image.LANCZOS)
            for k, (im, psm) in enumerate(((g, '6'), (g.point(lambda v: 255 if v > 140 else 0), '6'), (g, '4'))):
                f = os.path.join(tmp, f'v{k}.png')
                im.save(f)
                out.append(tess(f, '--psm', psm))
    return out


def parse_customs(text):
    """{'from', 'to', ccy: [readings]} from one OCR text (the rate is the last number on the currency's line)"""
    res = {c: [] for c in CCY}
    m = re.search(r'From\s+(\d{1,2}[.,/-]\d{1,2}[.,/-]\d{4})\s+to\s+(\d{1,2}[.,/-]\d{1,2}[.,/-]\d{4})', text, re.I)
    if m:
        res['from'], res['to'] = dmy(m.group(1).replace(',', '.')), dmy(m.group(2).replace(',', '.'))
    for line in text.splitlines():
        low = line.lower()
        for c, names in NAMES.items():
            if any(n in low for n in names):
                nums = NUM.findall(line)
                if nums:
                    try:
                        res[c].append(to_num(nums[-1]))
                    except ValueError:
                        pass
    return res


def read_customs(data, refs):
    """The schedule's dates and USD / EUR / GBP.

    Customs sets all three from one Central Bank day with one common factor (e.g. 1.013827 in the week from 05.10.2026), so
    two currencies whose readings give the same factor confirm each other; the third is then taken where a reading also
    fits, else worked out from the factor. refs: [CBSL rates of the days before the schedule, newest first]."""
    reads = {c: set() for c in CCY}
    dates = {}
    for t in ocr_texts(data):
        p = parse_customs(t)
        for c in CCY:
            reads[c].update(p[c])
        for k in ('from', 'to'):
            if k in p:
                dates.setdefault(k, p[k])
    print('  readings:', {c: sorted(v) for c, v in reads.items()})
    for ref in refs:
        if not all(ref.get(c) for c in CCY):
            continue
        ks = [(v / ref[c], c, v) for c in CCY for v in reads[c] if 0.9 < v / ref[c] < 1.1]
        pair = next(((k1 + k2) / 2 for k1, c1, _ in ks for k2, c2, _ in ks if c1 < c2 and abs(k1 - k2) < 3e-6), None)
        if pair is None:
            continue
        res, worked = dict(dates), []
        for c in CCY:
            hit = [v for k, cc, v in ks if cc == c and abs(k - pair) < 3e-6]
            if hit:
                res[c] = hit[0]
            else:
                res[c] = round(ref[c] * pair, 4)
                worked.append(c)
        res['factor'] = round(pair, 6)
        if worked:
            res['worked_out'] = worked
        return res
    return dates


def main():
    today = dt.date.today()
    last = {} if DRY else (rpc('fx_last_dates', {'p_secret': os.environ['FX_SECRET']}) or {})
    # Central Bank: from a few days before the last date we have (late publications), or a year back on the first run
    since = (dt.date.fromisoformat(last['cbsl']) - dt.timedelta(days=5)) if last.get('cbsl') else today - dt.timedelta(days=int(os.environ.get('BACKFILL_DAYS') or 400))
    rates = cbsl(since.isoformat())
    payload = {'cbsl': [{'date': d, **v} for d, v in sorted(rates.items())]}
    print(f'CBSL: {len(rates)} day(s) from {since} – latest', max(rates) if rates else None, rates.get(max(rates)) if rates else '')

    if not DRY:
        print('Saved:', rpc('fx_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': payload}))
    customs = None
    eff, url = customs_latest()
    print('Customs newest schedule:', eff, url)
    if eff and (DRY or not last.get('customs') or eff > last['customs']):
        try:
            # the Central Bank days before the schedule (Customs works from one of them)
            hist = cbsl((dt.date.fromisoformat(eff) - dt.timedelta(days=12)).isoformat())
            refs = [hist[d] for d in sorted(hist, reverse=True) if d < eff][:5]
            c = read_customs(get(url, binary=True), refs)
            c.setdefault('from', eff)
            if c.get('from') != eff:
                print(f'::warning::Customs: the PDF says from {c.get("from")}, the link says {eff} – using the link')
                c['from'] = eff
            c.setdefault('to', (dt.date.fromisoformat(eff) + dt.timedelta(days=6)).isoformat())
            c['ref'] = url
            print('Customs reading:', c)
            if all(k in c for k in CCY):
                customs = c
            else:
                print('::warning::Customs: could not read all of USD, EUR and GBP – the AM Estimation is asked to enter them')
        except Exception as e:  # the Central Bank rates still go in
            print(f'::warning::Customs reading failed: {e}')
    if DRY:
        print(json.dumps({**payload, 'customs': customs})[:2000])
    elif customs:
        print('Saved:', rpc('fx_ingest', {'p_secret': os.environ['FX_SECRET'], 'p': {'customs': customs}}))


if __name__ == '__main__':
    main()
