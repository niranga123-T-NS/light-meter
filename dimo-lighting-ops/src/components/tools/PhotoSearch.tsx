import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Button, Card, colors, Muted, Notice, Row, Select } from '@/components/ui';
import { pickImage } from '@/lib/files';
import { cctText, FIXTURE_TYPES, fmt, type Fixture } from '@/lib/fixtures';
import { fingerprintWeb, likeness, loadVisionIndex, rankByPhoto, VISION_PAGE } from '@/lib/photoSearch';
import { Thumb } from './FixtureLibrary';

type Job = { ok: (v: number[][]) => void; bad: (e: Error) => void };

// Phone and tablet: the fingerprint is made by the same page in a hidden web view (MediaPipe needs a browser engine)
function useFingerprinter() {
  const web = useRef<WebView>(null);
  const jobs = useRef(new Map<number, Job>());
  const ready = useRef(false);
  const queue = useRef<(() => void)[]>([]);
  const [on, setOn] = useState(false);
  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data) as { id?: number; v?: number[][]; error?: string; ready?: boolean };
    if (m.ready) {
      ready.current = true;
      queue.current.splice(0).forEach((f) => f());
      return;
    }
    if (m.id == null) {
      jobs.current.forEach((j) => j.bad(new Error(m.error ?? 'The photo reader could not start')));
      return jobs.current.clear();
    }
    const j = jobs.current.get(m.id);
    jobs.current.delete(m.id);
    if (m.error) j?.bad(new Error(m.error));
    else if (m.v) j?.ok(m.v);
  };
  const run = useCallback((src: string, crops: number[]) => {
    if (Platform.OS === 'web') return fingerprintWeb(src, crops);
    setOn(true);
    return new Promise<number[][]>((ok, bad) => {
      const id = Date.now();
      jobs.current.set(id, { ok, bad });
      const go = () => web.current?.injectJavaScript(`window.fingerprint(${id}, ${JSON.stringify(src)}, ${JSON.stringify(crops)}); true;`);
      if (ready.current) go();
      else queue.current.push(go);
    });
  }, []);
  const view = Platform.OS !== 'web' && on ? <WebView ref={web} source={{ uri: VISION_PAGE }} onMessage={onMessage} originWhitelist={['*']} style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} /> : null;
  return { run, view };
}

const line = (p: Fixture) => [p.code, p.w != null && `${p.w} W`, p.lm && `${fmt(p.lm)} lm`, cctText(p), p.ip && `IP${p.ip}`].filter(Boolean).join(' · ');

/** Search by photo: a photo of a fitting (site, competitor brochure, client picture) → the catalogue fittings that look most like it */
export function PhotoSearchView({ all, brands }: { all: Fixture[]; brands: string[] }) {
  const { run, view } = useFingerprinter();
  const [photo, setPhoto] = useState<string | null>(null);
  const [query, setQuery] = useState<number[][] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [brand, setBrand] = useState('');
  const [limit, setLimit] = useState(12);
  const [open, setOpen] = useState<string | null>(null);
  const [ix, setIx] = useState<Awaited<ReturnType<typeof loadVisionIndex>> | null>(null);
  const hits = useMemo(() => (ix && query ? rankByPhoto(ix, all, query, { type, brand }, limit) : []), [ix, all, query, type, brand, limit]);

  const pick = async (camera: boolean) => {
    setErr(null);
    try {
      const f = await pickImage(camera, Platform.OS !== 'web', Platform.OS !== 'web');
      if (!f) return;
      setPhoto(f.uri);
      setQuery(null);
      setBusy(ix ? 'Reading the photo…' : 'Loading the photo reader (about 18 MB, the first time only)…');
      const index = ix ?? (await loadVisionIndex());
      setIx(index);
      const src = Platform.OS === 'web' ? f.uri : `data:${f.mimeType ?? 'image/jpeg'};base64,${f.base64 ?? ''}`;
      setQuery(await run(src, index.query));
      setLimit(12);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {view}
      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Photo of the fitting</Text>
        <Row gap={12} wrap style={{ alignItems: 'center' }}>
          {photo ? <Image source={{ uri: photo }} style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: colors.soft }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
            <Row gap={8} wrap>
              <Button title="Take a photo" onPress={() => pick(true)} disabled={!!busy} />
              <Button title="Choose a picture" variant="secondary" onPress={() => pick(false)} disabled={!!busy} />
            </Row>
            <Muted>Site photo, brochure page or a picture from the client. Let the fitting fill the picture (crop it if you can) – a plain background works best.</Muted>
          </View>
        </Row>
        <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
          <Select label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...FIXTURE_TYPES.map((x) => ({ value: x, label: x }))]} />
          <Select label="Brand" value={brand} onChange={setBrand} options={[{ value: '', label: 'All brands' }, ...brands.map((x) => ({ value: x, label: x }))]} />
        </Row>
        {busy ? <Notice>{busy}</Notice> : null}
        {err ? <Notice tone={colors.amber}>{err}</Notice> : null}
      </Card>
      {query ? (
        <>
          <Muted>{`The catalogue photos that look most like yours – by shape, proportions and colour, not by values. Check the values in the product page or with Find a match.${type ? '' : ' Choosing the type narrows it down a lot.'}`}</Muted>
          {hits.length ? null : <Notice>Nothing with this type / brand – clear a filter.</Notice>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {hits.map((h) => {
              const p0 = h.products[0], fams = [...new Set(h.products.map((p) => p.fam || p.title))];
              const shown = open === h.img ? h.products : h.products.slice(0, 3);
              return (
                <Card key={h.img} style={{ padding: 10, gap: 6, flexGrow: 1, flexBasis: 300, maxWidth: 520 }}>
                  <Row gap={10}>
                    <Thumb p={{ img: h.img }} size={110} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: h.score >= 0.58 ? colors.green : colors.text }}>{`${likeness(h.score)} · ${Math.round(h.score * 100)} %`}</Text>
                      <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={2}>{`${p0.brand} · ${fams.slice(0, 2).join(' / ')}${fams.length > 2 ? ` +${fams.length - 2}` : ''}`}</Text>
                      <Muted numberOfLines={1}>{`${p0.type} · ${h.products.length} model${h.products.length > 1 ? 's' : ''} in this photo`}</Muted>
                    </View>
                  </Row>
                  {shown.map((p) => (
                    <Text key={p.id} onPress={() => router.push(`/fixtures/${encodeURIComponent(p.id)}`)} style={{ fontSize: 13, color: colors.blue }} numberOfLines={1}>{`› ${line(p)}`}</Text>
                  ))}
                  {h.products.length > 3 ? <Button small variant="ghost" title={open === h.img ? 'Fewer' : `All ${h.products.length} models`} onPress={() => setOpen(open === h.img ? null : h.img)} /> : null}
                </Card>
              );
            })}
          </View>
          {hits.length >= limit ? <Button variant="secondary" title="Show more" onPress={() => setLimit(limit + 12)} /> : null}
        </>
      ) : null}
    </View>
  );
}
