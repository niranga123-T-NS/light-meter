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


def ocr_pdf(data):
    """Full text of the PDF (for the dates and as a second reading)"""
    with tempfile.TemporaryDirectory() as tmp:
        return '\n'.join(tess(i, '--psm', '6') for i in page_images(data, tmp))


NUM = re.compile(r'(\d[\d,\s]*[.,]\s?\d{4})(?!\d)')
ANCHOR = {
    'USD': re.compile(r'^(usd|u5d|usp|uso|usa)\W*$|dollr|^us$', re.I),
    'EUR': re.compile(r'^(eu?rr?|euro)\W*$', re.I),
    'GBP': re.compile(r'^(gbp|g8p|gbf|cbp|sterling|kingdom)\W*$', re.I),
}


def to_num(v):
    v = re.sub(r'[\s,]', '', v[:-5]) + '.' + v[-4:]
    return float(v.replace('..', '.'))


def row_readings(data):
    """{ccy: [values]} – each currency's row found from its code / name, the rate cell cut out and read as digits only"""
    from PIL import Image, ImageOps
    out = {c: [] for c in CCY}
    with tempfile.TemporaryDirectory() as tmp:
        for img in page_images(data, tmp):
            words = []
            for ln in tess(img, '--psm', '6', 'tsv').splitlines()[1:]:
                p = ln.split('\t')
                if len(p) == 12 and p[11].strip():
                    words.append((int(p[6]), int(p[7]), int(p[8]), int(p[9]), p[11].strip()))
            nums = [w for w in words if NUM.search(w[4])]
            if len(nums) < 10:
                continue  # not the schedule page
            page = Image.open(img).convert('L')
            # the rate column: where the right-hand numbers start
            lefts = sorted(w[0] for w in nums if w[0] > page.width * 0.5)
            col = (lefts[len(lefts) // 10] if lefts else int(page.width * 0.7)) - 15
            rh = sorted(w[3] for w in words)[len(words) // 2]
            for c, rx in ANCHOR.items():
                for x, y, w, h, t in words:
                    if not rx.search(t):
                        continue
                    yc = y + h / 2
                    box = (col, max(0, int(yc - rh * 1.0)), page.width, int(yc + rh * 1.0))
                    cell = ImageOps.autocontrast(page.crop(box), cutoff=1)
                    cell = cell.resize((cell.width * 3, cell.height * 3), Image.LANCZOS)
                    for k, im in enumerate((cell, cell.point(lambda v: 255 if v > 150 else 0))):
                        f = os.path.join(tmp, f'cell{k}.png')
                        im.save(f)
                        m = NUM.search(tess(f, '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789.,'))
                        if m:
                            out[c].append(to_num(m.group(1)))
    return out


def parse_customs(text):
    """{'from', 'to', 'USD', 'EUR', 'GBP'} from the OCR text of the schedule"""
    res = {}
    m = re.search(r'From\s+(\d{1,2}[.,/-]\d{1,2}[.,/-]\d{4})\s+to\s+(\d{1,2}[.,/-]\d{1,2}[.,/-]\d{4})', text, re.I)
    if m:
        res['from'], res['to'] = dmy(m.group(1).replace(',', '.')), dmy(m.group(2).replace(',', '.'))
    # OCR of the scanned table is noisy ("—3 76.8259", "USDollr"): find each row by its names, take the last rate on the line
    keys = {'USD': ('usd', 'us dollar', 'usa'), 'EUR': ('eur',), 'GBP': ('gbp', 'sterling', 'united kingdom')}
    for line in text.splitlines():
        low = line.lower()
        for c, names in keys.items():
            if c in res or not any(n in low for n in names):
                continue
            nums = NUM.findall(line)
            if nums:
                res[c] = to_num(nums[-1])
    return res


def read_customs(data, ref):
    """The schedule's dates and USD / EUR / GBP. A value is taken when it is near the Central Bank rate (ref) and either
    two readings agree or the digits-only reading of the cell gives it."""
    text = ocr_pdf(data)
    full = parse_customs(text)
    rows = row_readings(data)
    res = {k: full[k] for k in ('from', 'to') if k in full}
    for c in CCY:
        near = lambda v: ref.get(c) and abs(v / ref[c] - 1) < 0.04
        votes = [v for v in rows[c] if near(v)]
        if c in full and near(full[c]):
            votes.append(full[c])
        best = max(set(votes), key=votes.count) if votes else None
        if best is not None and (votes.count(best) >= 2 or best in rows[c]):
            res[c] = best
        print(f'  {c}: cell readings {rows[c]}, text reading {full.get(c)}, CBSL {ref.get(c)} -> {res.get(c)}')
    return res


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
            # the Central Bank rate of the week before the schedule, to tell a good reading from a misread one
            ref_day = max([d for d in rates if d < eff] or [None]) if rates else None
            ref = rates.get(ref_day, {}) if ref_day else {}
            if not ref:
                back = cbsl((dt.date.fromisoformat(eff) - dt.timedelta(days=10)).isoformat())
                ref = back[max(d for d in back if d < eff)] if any(d < eff for d in back) else {}
            c = read_customs(get(url, binary=True), ref)
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
