#!/usr/bin/env python3
"""Temporary: which freight index sources answer from GitHub (prints notices; GitHub shows at most 10)."""
import json
import re
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


def get(u):
    req = urllib.request.Request(u, headers={'User-Agent': UA, 'Accept': 'application/json, text/html, */*'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')


out = []
try:
    d = json.loads(get('https://en.sse.net.cn/currentIndex?indexName=scfi'))['data']
    lines = [f"{x['properties'].get('lineName_EN')}|{x['properties'].get('unit_EN')}|{x.get('currentContent')}|{x.get('lastContent')}" for x in d['lineDataList']]
    keys = list(d['lineDataList'][0].keys())
    out.append(f"SCFI {d.get('currentDate')} keys={keys} :: " + ' ;; '.join(lines)[:900])
except Exception as e:  # noqa: BLE001
    out.append(f'SCFI FAIL {e}')
for u in ['https://en.sse.net.cn/indexHistory?indexName=scfi', 'https://en.sse.net.cn/historyIndex?indexName=scfi&startDate=2026-01-01&endDate=2026-10-23']:
    try:
        t = get(u)
        out.append(f'{u} {len(t)}B :: {re.sub(chr(10), " ", t[:300])}')
    except Exception as e:  # noqa: BLE001
        out.append(f'FAIL {u} {str(e)[:100]}')
try:
    t = get('https://terminal.freightos.com/')
    fbx = re.findall(r'(FBX\d{0,2}[^<>]{0,60}?\$?\s?[\d,]{3,6})', t)[:8]
    fax = re.findall(r'(FAX[^<>]{0,80}?\$\s?\d+\.\d+)', t)[:6]
    api = sorted(set(re.findall(r'https?://[a-z0-9.-]*freightos[a-z0-9./_-]*(?:api|json|data)[a-z0-9./_?=&-]*', t)))[:10]
    out.append(f'Freightos page fbx={fbx} fax={fax}')
    out.append(f'Freightos api links={api}')
except Exception as e:  # noqa: BLE001
    out.append(f'Freightos FAIL {e}')
for u in ['https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry']:
    try:
        t = get(u)
        m = re.findall(r'(Rotterdam[^<]{0,40}Shanghai[^<]{0,120}|composite[^<]{0,160})', t, flags=re.I)[:4]
        out.append(f'Drewry {len(t)}B :: {m}')
    except Exception as e:  # noqa: BLE001
        out.append(f'Drewry FAIL {str(e)[:150]}')
for o in out[:9]:
    print('::notice::' + o.replace('\n', ' ')[:1800])
