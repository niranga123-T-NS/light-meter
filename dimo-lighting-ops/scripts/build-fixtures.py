# Builds public/fixtures/library.json – the fixture library the app searches – from the catalogue extracts in data/catalogs/*.json.
# Run after adding or correcting a catalogue: python3 scripts/build-fixtures.py
# When photos were added or changed, then also rebuild the photo-search index: node scripts/build-fixture-vision.cjs
import json, re, glob, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(ROOT, 'data', 'catalogs')
OUT = os.path.join(ROOT, 'public', 'fixtures', 'library.json')
SRC = {'zc_lighting': ('ZC Lighting', 'ZC_2.pdf'), 'zc_lighting_part1': ('ZC Lighting', 'ZC_1.pdf'), 'grnled': ('GRNLED', '2026_GRNLED_Catalogue.pdf'), 'coreshine': ('CoreShine', 'Coreshine.pdf'),
       'hemnord': ('HEMNORD (Cregini)', 'HEMNORD_1.pdf'), 'hemnord_2': ('HEMNORD (Cregini)', 'HEMNORD_2 / Hem_nord_6 / Hem_nord_7.pdf'), 'hemnord_3': ('HEMNORD (Cregini)', 'HEMNORD_3 / Hem_nord_8.pdf'), 'intelight': ('Intelight', 'intelight_katalog_2026.pdf'), 'trilux': ('TRILUX', 'Trilux_1.pdf / Trilux_2.pdf (Product Portfolio 25)'), 'holux': ('Holux', 'Holux_1.pdf / Holux_2.pdf'), 'kyd': ('KYD', 'KYD_Catalog-NEW_version_1.pdf')}
TYPES = [('Strip / neon', r'strip|neon'), ('Tube / lamp', r'\btube\b|\blamp\b|bulb|corn|\bgu10\b|\bpar\b|ar111|candle|mirror'),
         ('Street light', r'street|road|post.?top|courtyard|garden pole|area light|high.?mast'), ('Floodlight', r'flood|sports|stadium|tennis|padel|façade|facade|architectural'),
         ('High bay', r'high.?bay|ufo'), ('Tri-proof / batten', r'tri.?proof|waterproof light|batten|bulkhead.*linear'),
         ('Panel', r'panel(?!.*downlight)|troffer|reflection'), ('Track / spot', r'track|magnetic|spot'), ('Downlight', r'downlight|down light|cylinder'),
         ('Linear', r'linear|trunking|pendant'), ('Ceiling light', r'ceiling'), ('Wall / bulkhead', r'wall|bulkhead|wall pack|step|ramp'),
         ('Outdoor landscape', r'bollard|in.?ground|underground|underwater|pool|deck|spike|garden|landscape|uplight|wall washer'), ('Other', r'.')]
FIX = {('coreshine', 'U-Line'): 'Linear', ('coreshine', 'T-Line K1'): 'Track / spot', ('kyd', 'D'): 'Wall / bulkhead', ('kyd', 'DL03'): 'Downlight', ('kyd', 'DL01-F'): 'Outdoor landscape',
       ('kyd', 'DL01-H'): 'Outdoor landscape', ('zc_lighting', 'FL20'): 'Floodlight', ('zc_lighting_part1', 'FL20'): 'Floodlight', ('holux', 'DLF'): 'Downlight'}
def ttype(*s):
    t = ' '.join(x for x in s if x).lower()
    if re.search(r'wall washer', t): return 'Outdoor landscape'
    for name, rx in TYPES:
        if re.search(rx, t): return name
def num(x):
    if x is None or isinstance(x, (int, float)): return x
    m = re.findall(r'\d+(?:\.\d+)?', str(x).replace(',', ''))
    return float(m[0]) if m else None
def nums(s): return [float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(s or '').replace(',', ''))]
def cct(s):
    s = str(s or '')
    ks = [int(k) for k in re.findall(r'(\d{4})\s*K?', s) if 1600 <= int(k) <= 12000]
    rng = bool(re.search(r'\d{4}\s*K?\s*(?:[–~-]|to)\s*\d{4}', s)) or 'tunable' in s.lower()
    return {'k': sorted(set(ks)), 'range': rng, 'rgb': bool(re.search(r'RGB', s))}
def first(rx, s, conv=float):
    m = re.search(rx, str(s or ''), re.I); return conv(m.group(1)) if m else None
def ipmax(s):
    v = [int(x) for x in re.findall(r'IP\s*(\d{2})', str(s or ''), re.I)]; return max(v) if v else None
def ikmax(s):
    v = [int(x) for x in re.findall(r'IK\s*(\d{2})', str(s or ''), re.I)]; return max(v) if v else None
def ugr(s):
    v = [float(x) for x in re.findall(r'<\s*(\d{2})', str(s or ''))]; return min(v) if v else None
def cri(s):
    v = [int(x) for x in re.findall(r'(\d{2})', str(s or '')) if 60 <= int(x) <= 99]; return max(v) if v else None
def ctrl(s):
    t = str(s or '').lower()
    return {'dali': 'dali' in t or 'dt6' in t or 'dt8' in t, 'v010': bool(re.search(r'[01]\s*-\s*10\s*v', t)), 'dmx': 'dmx' in t, 'triac': 'triac' in t,
            'sensor': bool(re.search(r'sensor|pir|radar|microwave', t)), 'smart': bool(re.search(r'bluetooth|\bble\b|zigbee|tuya|casambi|wifi|\bapp\b', t))}
def warr(s):
    v = nums(s); return int(max(v)) if v else None
def steps(s):
    m = re.search(r'(?:Power selectable|selectable|DIP)[^\d]*([\d./ W-]+W)', str(s or ''))
    v = [x for x in nums(m.group(1))] if m else []
    return sorted(set(v)) if len(v) > 1 else None
out, n = [], 0
for path in sorted(glob.glob(os.path.join(CAT, '*.json'))):
    key = os.path.basename(path)[:-5]
    if key not in SRC: continue
    brand, src = SRC[key]
    j = json.load(open(path))
    if key == 'grnled':
        fam_by_code = {}
        for f in j['families']:
            for it in f['items']: fam_by_code[it['code']] = f
        for r in j['rows']:
            f = fam_by_code.get(r['code'], {})
            text = ' '.join([r.get('features', ''), r.get('section_features', '')])
            eff = nums(r.get('eff')); lm = r.get('lm_est')
            out.append(dict(id=f'{key}:{r["code"]}', brand=brand, cat=key, src=src, page=str(r['page']), fam=r.get('family') or f.get('title') or r['title'], title=r['title'],
                type=ttype(r['category'], r['title']), code=r['code'], w=r.get('watts'), lm=lm, eff=max(eff) if eff else None, lmEst=True,
                cct=cct(text) if cct(text)['k'] else {'k': [3000, 4000, 6000], 'range': False, 'rgb': False}, cri=cri(r.get('cri')), ugr=ugr(r.get('ugr')), ip=ipmax(r.get('ip') or text), ik=ikmax(text),
                beam=r.get('beam') or '', ctrl=ctrl(text + ' ' + str(g.get('control') or '')), warranty=warr(r.get('warranty')), life=None, size=(r.get('size') or '') + (f" (cut-out {r['cutout']})" if r.get('cutout') else ''),
                voltage=r.get('voltage') or '', leds=r.get('leds') or '', note=' · '.join(x for x in (r.get('remark'), r.get('features')) if x),
                flag='Lumens estimated from the catalogue lm/W range (no lumen value printed)' + (f" · {r['note']}" if r.get('note') else ''),
                img=f.get('image') or '', shared=len(f.get('image_covers') or [])))
            n += 1
        continue
    for f in j['families']:
        for v in f['variants']:
            g = dict(f); g.update({k: x for k, x in v.items() if k not in ('note', 'flag', 'code', 'size')})
            text = ' '.join(str(g.get(k) or '') for k in ('control', 'power_steps', 'order_code', 'driver', 'emergency'))
            note = ' · '.join(x for x in (v.get('note'), f.get('power_steps') and f"Power steps: {f['power_steps']}") if x)
            out.append(dict(id=f'{key}:{v["code"]}', brand=brand, cat=key, src=f.get('pdf') or src, lmMin=v.get('lmMin'), url=f.get('url'), aut=v.get('aut'), emergency=v.get('emergency'), visibility=f.get('visibility'), extras=' · '.join(x for x in (f.get('design'), f.get('extras'), f.get('atex') and f'ATEX: {f["atex"]}', f.get('point_height') and f'Light point height {f["point_height"]}') if x), page=str(f.get('pages', '')), fam=f.get('family') or '', title=f.get('title', ''),
                type=f.get('type') if key == 'intelight' else FIX.get((key, f.get('family'))) or ttype(g.get('type'), f.get('title'), f.get('category')), code=v['code'], w=num(v.get('w')), lm=num(v.get('lm')), eff=num(v.get('eff')), lmEst=False,
                lm2=v.get('lm2'), cct=cct(g.get('cct')), cri=cri(g.get('cri')), ugr=ugr(g.get('ugr')), ip=ipmax(g.get('ip')), ik=ikmax(g.get('ik')), beam=str(g.get('beam') or ''),
                ctrl=ctrl(text + ' ' + str(g.get('control') or '')), warranty=warr(g.get('warranty')), life=num(g.get('life_h')), size=v.get('size') or '', steps=steps(v.get('note')), voltage=str(g.get('voltage') or ''),
                leds=str(g.get('leds') or ''), housing=str(g.get('housing') or ''), cover=str(g.get('cover') or ''), mounting=str(g.get('mounting') or ''), control=str(g.get('control') or ''),
                temp=str(g.get('temp') or ''), surge=str(g.get('surge') or ''), note=note, flag=' · '.join(x for x in (v.get('flag'), f.get('family_flag')) if x),
                img=f.get('image') or '', shared=len(f.get('image_covers') or [])))
            n += 1
for o in out:
    for k in [k for k, x in o.items() if x in (None, '', [], False) and k not in ('lmEst',)]: del o[k]
json.dump({'built': __import__('datetime').date.today().isoformat(), 'count': len(out), 'products': out}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(out), 'products →', OUT, os.path.getsize(OUT) // 1024, 'KB'); print(Counter(o['type'] for o in out).most_common())
