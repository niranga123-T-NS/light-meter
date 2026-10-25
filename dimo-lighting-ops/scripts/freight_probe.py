#!/usr/bin/env python3
"""Temporary: the SCFI reply in detail (with retries)."""
import json
import time
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
for k in range(6):
    try:
        req = urllib.request.Request('https://en.sse.net.cn/currentIndex?indexName=scfi', headers={'User-Agent': UA, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read().decode())['data']
        break
    except Exception as e:  # noqa: BLE001
        print(f'try {k}: {e}')
        time.sleep(10)
else:
    raise SystemExit('::error::SCFI did not answer')
print('::notice::top keys ' + json.dumps({k: v for k, v in d.items() if k != 'lineDataList'})[:600])
print('::notice::first line ' + json.dumps(d['lineDataList'][0], ensure_ascii=True)[:900])
rows = [f"{x['properties'].get('lineName_EN')} [{x['properties'].get('unit_EN')}] " + ' '.join(f'{k}={v}' for k, v in x.items() if k != 'properties') for x in d['lineDataList']]
for i in range(0, len(rows), 6):
    print('::notice::' + ' ;; '.join(rows[i:i + 6])[:1800])
