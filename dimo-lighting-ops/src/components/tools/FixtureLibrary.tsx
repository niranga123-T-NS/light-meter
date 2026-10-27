import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, ErrorBanner, Field, Loading, Muted, Notice, Pill, Row, Segmented, Select, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { pickDocument } from '@/lib/files';
import {
  bestMatches, buildPatch, CATALOG_SUPERVISORS, cctText, EDIT_FIELDS, editText, FIXTURE_TYPES, fixtureImage, fmt, loadCatalog, missingData, PARAMS, parseSpecText, readDatasheet, REGIONS,
  saveFixtureEdit, searchFixtures, setBrandRegion, STATUS_STYLE, wattText, type Catalog, type Fixture, type Level, type Match, type ParamKey, type Region, type Spec,
} from '@/lib/fixtures';
import { useLoad } from '@/lib/hooks';
import { BrandFilter } from './BrandFilter';
import { PhotoSearchView } from './PhotoSearch';

/** What a supervisor can do from a search result */
type Sup = { edit: (p: Fixture) => void; remove: (p: Fixture) => void; restore: (p: Fixture) => void; reset: (p: Fixture) => void; cat: Catalog };

/** Fixture library: every model from the manufacturer catalogues – quick search, search by photo, and "Find a match" for a BOQ line or a competitor datasheet.
 *  The DGM and SM Estimation get the catalog supervisor mode: brand categories, correct missing data, remove / restore products. */
export function FixtureLibrary() {
  const me = useMe();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => loadCatalog(), []);
  const [mode, setMode] = useState<'search' | 'photo' | 'match'>('search');
  const [supOn, setSupOn] = useState(false);
  const canSup = CATALOG_SUPERVISORS.includes(me.role);
  const brands = useMemo(() => (data ? [...new Set([...data.products, ...data.hidden].map((p) => p.brand))].sort() : []), [data]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const refresh = async () => { await loadCatalog(true); await reload(); };
  const sup: Sup | null = canSup && supOn ? {
    cat: data,
    edit: async (p) => {
      const form = await dialog.prompt({
        title: `Edit ${p.brand} ${p.code}`,
        message: 'Empty = no value. Only the values you change are kept – the catalogue data stays underneath and can be put back with "Back to catalogue data".',
        fields: EDIT_FIELDS.map((f) => (f.select ? { key: f.key, label: f.label, type: 'select' as const, options: FIXTURE_TYPES.map((x) => ({ value: x, label: x })), initial: editText(p, f.key) } : { key: f.key, label: f.label, initial: editText(p, f.key), hint: f.hint })),
        confirmLabel: 'Save',
      });
      if (form) await dialog.run(async () => { await saveFixtureEdit(p.id, { patch: buildPatch(data.raw[p.id], form) }); await refresh(); }, 'Product data saved');
    },
    remove: async (p) => {
      if (await dialog.confirm(`Remove ${p.brand} ${p.code}?`, 'It goes out of the main catalog list, the searches and the BOQ match for everyone. It can be restored under "Removed".', { confirmLabel: 'Remove', danger: true }))
        await dialog.run(async () => { await saveFixtureEdit(p.id, { hidden: true }); await refresh(); }, 'Removed from the catalog');
    },
    restore: (p) => void dialog.run(async () => { await saveFixtureEdit(p.id, { hidden: false }); await refresh(); }, 'Back in the catalog'),
    reset: async (p) => {
      if (await dialog.confirm(`Back to the catalogue data for ${p.brand} ${p.code}?`, 'Your corrections to this product are deleted.', { confirmLabel: 'Put back', danger: true }))
        await dialog.run(async () => { await saveFixtureEdit(p.id, { patch: {} }); await refresh(); }, 'Catalogue data put back');
    },
  } : null;
  return (
    <View style={{ gap: 10 }}>
      {canSup ? (
        <Row gap={10} wrap style={{ alignItems: 'center' }}>
          <View style={{ minWidth: 260 }}><Toggle label="Catalog supervisor mode" value={supOn} onChange={setSupOn} /></View>
          {supOn ? <Muted>Only the DGM and SM Estimation see this: brand categories, correct or delete product data, remove products from the catalog.</Muted> : null}
        </Row>
      ) : null}
      {sup ? <BrandCategories brands={brands} cat={data} onSet={(b, r) => dialog.run(async () => { await setBrandRegion(b, r); await refresh(); })} /> : null}
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'photo', label: 'Search by photo' },
          { value: 'match', label: 'Find a match (BOQ line / competitor datasheet)' },
        ]}
      />
      <Muted>{`${data.products.length.toLocaleString('en-US')} products · ${brands.length} brands · ${brands.join(', ')}${data.hidden.length ? ` · ${data.hidden.length} removed` : ''}`}</Muted>
      {mode === 'search' ? <SearchView all={data.products} brands={brands} regions={data.regions} sup={sup} /> : mode === 'photo' ? <PhotoSearchView all={data.products} brands={brands} regions={data.regions} /> : <MatchView all={data.products} brands={brands} regions={data.regions} />}
    </View>
  );
}

/** Supervisor: each brand under European, China, Local or Other */
function BrandCategories({ brands, cat, onSet }: { brands: string[]; cat: Catalog; onSet: (brand: string, r: Region | null) => void }) {
  const count = (b: string) => cat.products.filter((p) => p.brand === b).length;
  return (
    <Card style={{ gap: 6 }}>
      <Text style={{ fontWeight: '700', color: colors.ink }}>Brand categories</Text>
      <Muted>Used by everyone to search in a group of brands (e.g. European only). Tap a category to set it.</Muted>
      {brands.map((b) => (
        <Row key={b} gap={8} wrap style={{ alignItems: 'center', paddingVertical: 2, borderBottomWidth: 1, borderColor: '#F3F4F6' }}>
          <Text style={{ width: 170, fontWeight: '700', color: colors.ink }}>{b}</Text>
          <Muted style={{ width: 90, fontSize: 12 }}>{`${count(b)} products`}</Muted>
          {REGIONS.map((r) => <Chip key={r.v} label={r.label} on={cat.regions[b] === r.v} onPress={() => onSet(b, cat.regions[b] === r.v ? null : r.v)} />)}
          {!cat.regions[b] ? <Text style={{ fontSize: 12, color: colors.amber }}>not set</Text> : null}
        </Row>
      ))}
    </Card>
  );
}

export function Thumb({ p, size = 64, height }: { p: Pick<Fixture, 'img'>; size?: number; height?: number }) {
  const uri = fixtureImage(p);
  const h = height ?? size;
  return (
    <View style={{ width: size, height: h, borderRadius: 6, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: h }} resizeMode="contain" /> : <Text style={{ fontSize: 10, color: colors.faint }}>no photo</Text>}
    </View>
  );
}

const spec1 = (p: Fixture) =>
  [wattText(p), p.lm && `${p.lmMin && p.lmMin < p.lm ? `${fmt(p.lmMin)}–` : ''}${fmt(p.lm)} lm${p.lmEst ? ' (est.)' : ''}`, p.eff && `${p.eff} lm/W`, cctText(p), p.cri && `CRI ${p.cri}`, p.ugr && `UGR<${p.ugr}`, p.ip && `IP${p.ip}`, p.beam]
    .filter(Boolean)
    .join(' · ');

/* ───────── Search ───────── */
function SearchView({ all, brands, regions, sup }: { all: Fixture[]; brands: string[]; regions: Record<string, Region>; sup: Sup | null }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [brandSel, setBrandSel] = useState<string[]>([]);
  const [show, setShow] = useState<'all' | 'missing' | 'edited' | 'removed'>('all');
  const [limit, setLimit] = useState(60);
  const view = sup ? show : 'all';
  const src = useMemo(() => (view === 'removed' ? sup!.cat.hidden : view === 'missing' ? all.filter((p) => missingData(p).length) : view === 'edited' ? all.filter((p) => p.edited) : all), [all, sup, view]);
  const hits = useMemo(() => searchFixtures(src, q, { type, brands: brandSel }), [src, q, type, brandSel]);
  return (
    <View style={{ gap: 8 }}>
      <Field label="Search" value={q} onChangeText={(t) => { setQ(t); setLimit(60); }} placeholder="Code, name or values – e.g. BP-6060, panel 36w ugr19 dali, flood 200w ip66 4000k" autoCapitalize="none" />
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...FIXTURE_TYPES.map((x) => ({ value: x, label: x }))]} />
      </Row>
      <BrandFilter brands={brands} regions={regions} value={brandSel} onChange={setBrandSel} />
      {sup ? (
        <Row gap={6} wrap>
          <Chip label="In the catalog" on={show === 'all'} onPress={() => setShow('all')} />
          <Chip label={`Missing data (${all.filter((p) => missingData(p).length).length})`} tone={colors.amber} on={show === 'missing'} onPress={() => setShow('missing')} />
          <Chip label={`Corrected (${all.filter((p) => p.edited).length})`} tone={colors.blue} on={show === 'edited'} onPress={() => setShow('edited')} />
          <Chip label={`Removed (${sup.cat.hidden.length})`} tone={colors.red} on={show === 'removed'} onPress={() => setShow('removed')} />
        </Row>
      ) : null}
      <Muted>{`${hits.length.toLocaleString('en-US')} found${q ? '' : ' – type to narrow down'}. Values: 36w · 4000lm · 4000k · ip65 · ik08 · ugr19 · cri90 · dali`}</Muted>
      {hits.slice(0, limit).map((p) => (
        <Card key={p.id} onPress={() => router.push(`/fixtures/${encodeURIComponent(p.id)}`)} style={{ padding: 10 }}>
          <Row gap={12} style={{ alignItems: 'center' }}>
            <Thumb p={p} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${p.brand} ${p.code}`}</Text>
              <Muted numberOfLines={1}>{`${p.type} · ${p.title}`}</Muted>
              <Text style={{ fontSize: 13, color: colors.text }}>{spec1(p)}</Text>
              {p.flag ? <Text style={{ fontSize: 12, color: colors.amber }} numberOfLines={1}>{`⚠ ${p.flag}`}</Text> : null}
              {sup && missingData(p).length ? <Text style={{ fontSize: 12, color: colors.amber }}>{`Missing: ${missingData(p).join(', ')}`}</Text> : null}
            </View>
            {sup ? (
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                {p.edited ? <Pill label="Corrected" tone={colors.blue} /> : null}
                {view === 'removed' ? (
                  <Button small title="Restore" onPress={() => sup.restore(p)} />
                ) : (
                  <Row gap={6}>
                    <Button small variant="secondary" title="Edit data" onPress={() => sup.edit(p)} />
                    {p.edited ? <Button small variant="ghost" title="Back to catalogue data" onPress={() => sup.reset(p)} /> : null}
                    <Button small variant="danger" title="Remove" onPress={() => sup.remove(p)} />
                  </Row>
                )}
              </View>
            ) : null}
          </Row>
        </Card>
      ))}
      {hits.length > limit ? <Button variant="secondary" title={`Show more (${hits.length - limit} left)`} onPress={() => setLimit(limit + 60)} /> : null}
    </View>
  );
}

/* ───────── Find a match ───────── */
const LEVELS: { v: Level; t: string }[] = [{ v: 'must', t: 'Must' }, { v: 'important', t: 'Important' }, { v: 'nice', t: 'Nice' }];

function MatchView({ all, brands, regions }: { all: Fixture[]; brands: string[]; regions: Record<string, Region> }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [spec, setSpec] = useState<Spec>({});
  const [n, setN] = useState(3);
  const [brandSel, setBrandSel] = useState<string[]>([]);
  const [view, setView] = useState<'compare' | 'cards'>('compare');
  const [devOnly, setDevOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ran, setRan] = useState<Spec | null>(null);
  const results = useMemo(() => (ran ? bestMatches(all, ran, n, brandSel) : []), [all, ran, n, brandSel]);

  const read = (t: string) => {
    const s = parseSpecText(t);
    setSpec(s);
    setRan(null);
    if (!Object.keys(s).length) setErr('No values found in the text – type them in the table below.');
    else setErr(null);
  };
  const attach = async () => {
    const f = await pickDocument();
    if (!f) return;
    try {
      const t = await readDatasheet(f);
      setFile(f.name);
      setText(t.slice(0, 4000));
      read(t);
      if (!t.trim()) setErr('This PDF has no text (a scan or a picture) – type the values in the table below.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const set = (k: ParamKey, v: string) => setSpec((s) => ({ ...s, [k]: { v, level: s[k]?.level ?? PARAMS.find((p) => p.key === k)!.level } }));
  const lvl = (k: ParamKey, level: Level) => setSpec((s) => ({ ...s, [k]: { v: s[k]?.v ?? '', level } }));
  const filled = Object.values(spec).filter((x) => x?.v.trim()).length;

  return (
    <View style={{ gap: 10 }}>
      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>1 · What is needed</Text>
        <Row gap={8} wrap>
          <Button title="Attach competitor datasheet (PDF)" variant="secondary" onPress={attach} />
          {file ? <Muted>{`Read: ${file}`}</Muted> : null}
        </Row>
        <Field label="Or paste the BOQ line / spec text" value={text} onChangeText={setText} multiline placeholder="LED panel 600x600, 36W, 4000lm, 4000K, CRI>80, UGR<19, IP40, DALI, 5 years warranty" />
        <Row gap={8} wrap>
          <Button small title="Read the text" onPress={() => read(text)} disabled={!text.trim()} />
          <Button small variant="ghost" title="Clear" onPress={() => { setText(''); setFile(''); setSpec({}); setRan(null); setErr(null); }} />
        </Row>
        {err ? <Notice tone={colors.amber}>{err}</Notice> : null}
      </Card>

      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>2 · Check the values and how strict each one is</Text>
        <Muted>Leave a value empty to ignore it. Must = a miss ranks the option down; Important and Nice count less.</Muted>
        {PARAMS.map((p) => {
          const cur = spec[p.key];
          const empty = !cur?.v.trim();
          return (
            <Row key={p.key} gap={8} wrap style={{ alignItems: 'center', paddingVertical: 2 }}>
              <Text style={{ width: 120, fontWeight: '600', color: colors.ink }}>{p.label}</Text>
              <View style={{ width: 200 }}>
                <Field label="" value={cur?.v ?? ''} onChangeText={(v) => set(p.key, v)} placeholder={p.hint} />
              </View>
              <Row gap={4}>
                {LEVELS.map((l) => (
                  <Chip key={l.v} label={l.t} on={!empty && (cur?.level ?? p.level) === l.v} onPress={() => lvl(p.key, l.v)} />
                ))}
              </Row>
              <Muted style={{ fontSize: 12 }}>{p.tol}</Muted>
            </Row>
          );
        })}
        <BrandFilter brands={brands} regions={regions} value={brandSel} onChange={setBrandSel} label="Brands to choose from" />
        <Row gap={8} wrap style={{ alignItems: 'flex-end', marginTop: 6 }}>
          <View>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>Options to show</Text>
            <Row gap={4}>
              {[1, 2, 3, 4, 5].map((x) => (
                <Chip key={x} label={String(x)} on={n === x} onPress={() => setN(x)} />
              ))}
            </Row>
          </View>
          <Button title={`Find ${n} best option${n === 1 ? '' : 's'} →`} disabled={!filled} onPress={() => setRan({ ...spec })} />
        </Row>
      </Card>

      {ran ? (
        <View style={{ gap: 8 }}>
          {results.length ? (
            <Notice tone={results[0].fails || results[0].minors ? colors.amber : colors.green}>
              {results[0].fails || results[0].minors
                ? `No exact match – showing the ${results.length} closest. Best: ${results[0].p.brand} ${results[0].p.code} (${results[0].score} %) with ${summary(results[0])}.`
                : `${results[0].p.brand} ${results[0].p.code} meets every value asked.`}
            </Notice>
          ) : (
            <Notice>Nothing to compare – fill in at least one value.</Notice>
          )}
          <Row gap={6} wrap>
            <Chip label="Side by side" on={view === 'compare'} onPress={() => setView('compare')} />
            <Chip label="Cards" on={view === 'cards'} onPress={() => setView('cards')} />
            {view === 'compare' ? <Chip label="Only rows with deviations" on={devOnly} onPress={() => setDevOnly(!devOnly)} /> : null}
          </Row>
          {view === 'compare' ? <CompareTable spec={ran} results={results} devOnly={devOnly} /> : <MatchCards spec={ran} results={results} />}
          <Legend />
        </View>
      ) : null}
    </View>
  );
}

const summary = (m: Match) =>
  m.fails ? `${m.fails} not met${m.minors ? ` · ${m.minors} small` : ''}` : m.minors ? `${m.minors} small deviation${m.minors > 1 ? 's' : ''}` : 'meets all';
const scoreTone = (s: number) => (s >= 90 ? colors.green : s >= 75 ? colors.amber : colors.red);

function CompareTable({ spec, results, devOnly }: { spec: Spec; results: Match[]; devOnly: boolean }) {
  const keys = PARAMS.filter((p) => spec[p.key]?.v.trim()).filter((p) => !devOnly || results.some((m) => !['ok', 'up'].includes(m.cells[p.key]?.status ?? 'ok')));
  const COL = 210;
  return (
    <ScrollView horizontal>
      <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', backgroundColor: colors.soft, borderBottomWidth: 1, borderColor: colors.line }}>
          <View style={{ width: 130, padding: 8, justifyContent: 'flex-end' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Parameter</Text>
          </View>
          <View style={{ width: 130, padding: 8, justifyContent: 'flex-end', borderLeftWidth: 1, borderColor: colors.line }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>Asked</Text>
          </View>
          {results.map((m, i) => (
            <Pressable key={m.p.id} onPress={() => router.push(`/fixtures/${encodeURIComponent(m.p.id)}`)} style={{ width: COL, padding: 8, gap: 4, borderLeftWidth: 1, borderColor: colors.line }}>
              <Thumb p={m.p} size={COL - 16} height={130} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted }}>{`Option ${i + 1}`}</Text>
                <Text style={{ fontSize: 16, fontWeight: '800', color: scoreTone(m.score) }}>{`${m.score}%`}</Text>
              </Row>
              <Text style={{ fontWeight: '800', color: colors.ink }}>{`${m.p.brand} ${m.p.code}`}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={2}>{m.p.title}</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: m.fails ? colors.red : m.minors ? colors.amber : colors.green }}>{summary(m)}</Text>
              {(m.p.shared ?? 0) > 1 ? <Text style={{ fontSize: 10, color: colors.faint }}>{`family photo · ${m.p.shared} models`}</Text> : null}
            </Pressable>
          ))}
        </View>
        {keys.map((p) => (
          <View key={p.key} style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#F3F4F6' }}>
            <View style={{ width: 130, padding: 8 }}>
              <Text style={{ fontWeight: '700', color: colors.ink, fontSize: 13 }}>{p.label}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: spec[p.key]!.level === 'must' ? colors.brand : colors.muted }}>{LEVELS.find((l) => l.v === spec[p.key]!.level)!.t}</Text>
            </View>
            <View style={{ width: 130, padding: 8, backgroundColor: colors.soft, borderLeftWidth: 1, borderColor: colors.line }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>{spec[p.key]!.v}</Text>
            </View>
            {results.map((m) => {
              const c = m.cells[p.key];
              const st = STATUS_STYLE[c?.status ?? 'na'];
              return (
                <View key={m.p.id} style={{ width: COL, padding: 8, backgroundColor: st.bg, borderLeftWidth: 1, borderColor: colors.line, gap: 2 }}>
                  <Text style={{ fontSize: 13, color: colors.ink }} numberOfLines={2}>{c?.value || '—'}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: st.fg }}>{`${st.icon} ${c?.dev || st.label}`}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MatchCards({ spec, results }: { spec: Spec; results: Match[] }) {
  return (
    <View style={{ gap: 8 }}>
      {results.map((m, i) => (
        <Card key={m.p.id} onPress={() => router.push(`/fixtures/${encodeURIComponent(m.p.id)}`)} style={{ padding: 10 }}>
          <Row gap={12} style={{ alignItems: 'center' }}>
            <View style={{ width: 56, alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: scoreTone(m.score) }}>{`${m.score}%`}</Text>
              <Muted style={{ fontSize: 11 }}>{`option ${i + 1}`}</Muted>
            </View>
            <Thumb p={m.p} size={72} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${m.p.brand} ${m.p.code}`}</Text>
              <Muted numberOfLines={1}>{m.p.title}</Muted>
              <Row gap={4} wrap>
                {PARAMS.filter((p) => spec[p.key]?.v.trim() && m.cells[p.key] && m.cells[p.key]!.status !== 'ok').map((p) => {
                  const c = m.cells[p.key]!;
                  const st = STATUS_STYLE[c.status];
                  return (
                    <View key={p.key} style={{ backgroundColor: st.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 12, color: st.fg }}>{`${st.icon} ${p.label}: ${c.value}${c.dev ? ` (${c.dev})` : ''}`}</Text>
                    </View>
                  );
                })}
                {!m.fails && !m.minors ? <Text style={{ fontSize: 12, color: colors.green }}>✓ Meets every value asked</Text> : null}
              </Row>
            </View>
          </Row>
        </Card>
      ))}
    </View>
  );
}

function Legend() {
  return (
    <Row gap={6} wrap>
      {(['ok', 'up', 'minor', 'fail', 'na'] as const).map((s) => (
        <View key={s} style={{ backgroundColor: STATUS_STYLE[s].bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: STATUS_STYLE[s].fg }}>{`${STATUS_STYLE[s].icon} ${STATUS_STYLE[s].label}`}</Text>
        </View>
      ))}
      <Muted style={{ fontSize: 12 }}>Match % is weighted by Must / Important / Nice; one option per product family.</Muted>
    </Row>
  );
}

