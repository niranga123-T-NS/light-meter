import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Chip, colors, ErrorBanner, Field, Loading, Muted, Notice, Row, Segmented, Select } from '@/components/ui';
import { pickDocument } from '@/lib/files';
import {
  bestMatches, cctText, FIXTURE_TYPES, fixtureImage, fmt, loadFixtures, PARAMS, parseSpecText, readDatasheet, searchFixtures, STATUS_STYLE,
  type Fixture, type Level, type Match, type ParamKey, type Spec,
} from '@/lib/fixtures';
import { useLoad } from '@/lib/hooks';
import { PhotoSearchView } from './PhotoSearch';

/** Fixture library: every model from the manufacturer catalogues – quick search, search by photo, and "Find a match" for a BOQ line or a competitor datasheet */
export function FixtureLibrary() {
  const { data, error } = useLoad(() => loadFixtures(), []);
  const [mode, setMode] = useState<'search' | 'photo' | 'match'>('search');
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;
  const brands = [...new Set(data.products.map((p) => p.brand))].sort();
  return (
    <View style={{ gap: 10 }}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'photo', label: 'Search by photo' },
          { value: 'match', label: 'Find a match (BOQ line / competitor datasheet)' },
        ]}
      />
      <Muted>{`${data.products.length.toLocaleString('en-US')} products · ${brands.length} brands · ${brands.join(', ')}`}</Muted>
      {mode === 'search' ? <SearchView all={data.products} brands={brands} /> : mode === 'photo' ? <PhotoSearchView all={data.products} brands={brands} /> : <MatchView all={data.products} brands={brands} />}
    </View>
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
  [p.w != null && `${p.w} W`, p.lm && `${p.lmMin && p.lmMin < p.lm ? `${fmt(p.lmMin)}–` : ''}${fmt(p.lm)} lm${p.lmEst ? ' (est.)' : ''}`, p.eff && `${p.eff} lm/W`, cctText(p), p.cri && `CRI ${p.cri}`, p.ugr && `UGR<${p.ugr}`, p.ip && `IP${p.ip}`, p.beam]
    .filter(Boolean)
    .join(' · ');

/* ───────── Search ───────── */
function SearchView({ all, brands }: { all: Fixture[]; brands: string[] }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [brand, setBrand] = useState('');
  const [limit, setLimit] = useState(60);
  const hits = useMemo(() => searchFixtures(all, q, { type, brand }), [all, q, type, brand]);
  return (
    <View style={{ gap: 8 }}>
      <Field label="Search" value={q} onChangeText={(t) => { setQ(t); setLimit(60); }} placeholder="Code, name or values – e.g. BP-6060, panel 36w ugr19 dali, flood 200w ip66 4000k" autoCapitalize="none" />
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...FIXTURE_TYPES.map((x) => ({ value: x, label: x }))]} />
        <Select label="Brand" value={brand} onChange={setBrand} options={[{ value: '', label: 'All brands' }, ...brands.map((x) => ({ value: x, label: x }))]} />
      </Row>
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
            </View>
          </Row>
        </Card>
      ))}
      {hits.length > limit ? <Button variant="secondary" title={`Show more (${hits.length - limit} left)`} onPress={() => setLimit(limit + 60)} /> : null}
    </View>
  );
}

/* ───────── Find a match ───────── */
const LEVELS: { v: Level; t: string }[] = [{ v: 'must', t: 'Must' }, { v: 'important', t: 'Important' }, { v: 'nice', t: 'Nice' }];

function MatchView({ all, brands }: { all: Fixture[]; brands: string[] }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [spec, setSpec] = useState<Spec>({});
  const [n, setN] = useState(3);
  const [brand, setBrand] = useState('');
  const [view, setView] = useState<'compare' | 'cards'>('compare');
  const [devOnly, setDevOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ran, setRan] = useState<Spec | null>(null);
  const results = useMemo(() => (ran ? bestMatches(all, ran, n, brand) : []), [all, ran, n, brand]);

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
        <Row gap={8} wrap style={{ alignItems: 'flex-end', marginTop: 6 }}>
          <View>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>Options to show</Text>
            <Row gap={4}>
              {[1, 2, 3, 4, 5].map((x) => (
                <Chip key={x} label={String(x)} on={n === x} onPress={() => setN(x)} />
              ))}
            </Row>
          </View>
          <Select label="Brand" value={brand} onChange={setBrand} options={[{ value: '', label: 'All brands' }, ...brands.map((x) => ({ value: x, label: x }))]} />
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

