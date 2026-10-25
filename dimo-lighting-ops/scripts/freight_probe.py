#!/usr/bin/env python3
"""Temporary: which freight index sources answer from GitHub (prints notices)."""
import re
import urllib.request

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
URLS = [
    'https://fbx.freightos.com/api/lane/FBX12?isDaily=true',
    'https://fbx.freightos.com/api/lane/FBX11?isDaily=true',
    'https://terminal.freightos.com/fbx-12-north-europe-to-china-east-asia/',
    'https://terminal.freightos.com/freightos-air-index/',
    'https://terminal.freightos.com/',
    'https://www.freightos.com/enterprise/terminal/freightos-air-index-fax/',
    'https://en.sse.net.cn/indices/scfinew.jsp',
    'https://www.sse.net.cn/index/singleIndex?indexType=scfi',
    'https://en.sse.net.cn/currentIndex?indexName=scfi',
    'https://www.sse.net.cn/indexIntro?indexName=scfi',
    'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
]
for u in URLS:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': UA, 'Accept': 'application/json, text/html'})
        with urllib.request.urlopen(req, timeout=40) as r:
            t = r.read().decode('utf-8', 'replace')
            body = re.sub(r'\s+', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S))
            nums = re.findall(r'(?:FBX\d+|FAX\d*|Composite|composite|Rotterdam|Persian|Europe)[^<]{0,80}', t)[:6]
            print(f'::notice::{r.status} {len(t)}B {u} :: {body[:220]} :: {nums}')
    except Exception as e:  # noqa: BLE001
        print(f'::notice::FAIL {u} :: {str(e)[:150]}')
