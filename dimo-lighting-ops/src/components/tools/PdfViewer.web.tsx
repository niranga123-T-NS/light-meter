import { PDFDocument } from 'pdf-lib';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ActivityIndicator, Modal, Text, TextInput, View } from 'react-native';
import { Button, colors, Muted, Notice, Row } from '@/components/ui';
import { openLink, pdfBytes, shareWatermarked, type PdfDoc } from '@/lib/catalog';
import { deliver } from '@/lib/hseFill';
import { watermarkPdf } from '@/lib/watermark';

type Vp = { width: number; height: number; transform: number[] };
type TextItem = { str: string; transform: number[]; width: number; height: number };
type PjPage = {
  getViewport: (o: { scale: number }) => Vp;
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: TextItem[] }>;
};
type PjDoc = { numPages: number; getPage: (n: number) => Promise<PjPage>; destroy: () => Promise<void> };
type PjLib = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: Uint8Array }) => { promise: Promise<PjDoc> }; Util: { transform: (a: number[], b: number[]) => number[] } };
const pj = () => (window as unknown as { pdfjsLib?: PjLib }).pdfjsLib;
let pjReady: Promise<PjLib> | null = null;
function loadPdfJs() {
  pjReady ??= new Promise<PjLib>((resolve, reject) => {
    if (pj()) return resolve(pj()!);
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      const lib = pj();
      if (!lib) return reject(new Error('The PDF viewer did not load'));
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => {
      pjReady = null;
      reject(new Error('The PDF viewer did not load'));
    };
    document.head.appendChild(s);
  });
  return pjReady;
}

/** A box on a page, as fractions of the page's width and height */
type Box = { x: number; y: number; w: number; h: number };
type Hit = { page: number; snippet: string; boxes: Box[] };

/** "5-8, 12" → [5, 6, 7, 8, 12], within 1..n */
export function parsePages(text: string, n: number) {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`“${part}” is not a page or a range – e.g. 5-8, 12`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > n || a > b) throw new Error(`Pages go from 1 to ${n}`);
    for (let p = a; p <= b; p++) if (!out.includes(p)) out.push(p);
  }
  if (!out.length) throw new Error('Give the pages, e.g. 5-8, 12');
  return out;
}

/** The pages of a PDF drawn with pdf.js (tablets and phones show only the first page of a PDF in a frame). Pages are drawn as
 *  they scroll into view and cleared when far away, so a 300-page catalogue does not run the tablet out of memory. Zoom
 *  re-draws only the pages in view; search reads the text of each page once. */
class Pages {
  doc: PjDoc | null = null;
  lib: PjLib | null = null;
  holders: HTMLDivElement[] = [];
  ratios: number[] = [];
  drawn = new Map<number, HTMLCanvasElement>();
  visible = new Set<number>();
  marks = new Map<number, { boxes: Box[]; current: boolean }>();
  texts = new Map<number, TextItem[] & { vp?: Vp }>();
  io: IntersectionObserver | null = null;
  zoom = 1;
  dead = false;
  constructor(public root: HTMLDivElement, public onPage: (n: number) => void) {}

  async open(bytes: Uint8Array) {
    this.lib = await loadPdfJs();
    this.doc = await this.lib.getDocument({ data: bytes.slice() }).promise;
    if (this.dead) return 0;
    const first = (await this.doc.getPage(1)).getViewport({ scale: 1 });
    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLDivElement).dataset.page);
          if (e.isIntersecting) {
            this.visible.add(n);
            void this.draw(n);
          } else {
            this.visible.delete(n);
            this.clear(n);
          }
        }
      },
      { root: this.root, rootMargin: '1500px 0px' },
    );
    this.root.replaceChildren();
    for (let n = 1; n <= this.doc.numPages; n++) {
      const el = document.createElement('div');
      el.dataset.page = String(n);
      el.style.cssText = 'position:relative;margin:0 auto 10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)';
      this.ratios[n] = first.height / first.width;
      this.holders[n] = el;
      this.root.appendChild(el);
    }
    this.layout();
    for (let n = 1; n <= this.doc.numPages; n++) this.io.observe(this.holders[n]);
    this.root.onscroll = () => this.onPage(this.current());
    return this.doc.numPages;
  }
  width() {
    return Math.max(160, (this.root.clientWidth - 20) * this.zoom);
  }
  layout() {
    const w = this.width();
    for (let n = 1; n < this.holders.length; n++) {
      this.holders[n].style.width = `${w}px`;
      this.holders[n].style.height = `${w * this.ratios[n]}px`;
    }
  }
  setZoom(z: number) {
    if (!this.doc || z === this.zoom) return;
    const keep = this.current();
    const frac = (this.root.scrollTop - this.holders[keep].offsetTop) / this.holders[keep].offsetHeight;
    this.zoom = z;
    this.layout();
    this.root.scrollTop = this.holders[keep].offsetTop + frac * this.holders[keep].offsetHeight;
    this.root.scrollLeft = (this.root.scrollWidth - this.root.clientWidth) / 2;
    for (const n of [...this.drawn.keys()]) this.clear(n);
    for (const n of this.visible) void this.draw(n);
  }
  current() {
    const top = this.root.scrollTop + this.root.clientHeight / 3;
    let lo = 1;
    let hi = this.holders.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.holders[mid].offsetTop <= top) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  goTo(n: number) {
    const el = this.holders[n];
    if (el) this.root.scrollTop = el.offsetTop - 8;
  }
  async draw(n: number) {
    if (this.drawn.has(n) || !this.doc) return;
    const c = document.createElement('canvas');
    this.drawn.set(n, c);
    const pg = await this.doc.getPage(n);
    const vp1 = pg.getViewport({ scale: 1 });
    if (Math.abs(this.ratios[n] - vp1.height / vp1.width) > 0.001) {
      this.ratios[n] = vp1.height / vp1.width;
      this.holders[n].style.height = `${this.width() * this.ratios[n]}px`;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // a canvas larger than ~16 million pixels is blank on iPad Safari
    const scale = Math.min((this.width() * dpr) / vp1.width, Math.sqrt(16e6 / (vp1.width * vp1.height)));
    const vp = pg.getViewport({ scale });
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    c.style.cssText = 'width:100%;height:100%;display:block';
    await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    if (this.drawn.get(n) !== c || this.dead) return;
    this.holders[n].replaceChildren(c);
    this.paintMarks(n);
  }
  clear(n: number) {
    const c = this.drawn.get(n);
    if (!c) return;
    this.drawn.delete(n);
    c.width = 0;
    c.height = 0;
    this.holders[n].replaceChildren();
  }
  paintMarks(n: number) {
    const el = this.holders[n];
    if (!el) return;
    el.querySelectorAll('.hl').forEach((x) => x.remove());
    const m = this.marks.get(n);
    if (!m) return;
    for (const b of m.boxes) {
      const d = document.createElement('div');
      d.className = 'hl';
      d.style.cssText = `position:absolute;left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%;background:${m.current ? 'rgba(255,140,0,.45)' : 'rgba(255,230,0,.4)'};mix-blend-mode:multiply;pointer-events:none`;
      el.appendChild(d);
    }
  }
  setMarks(hits: Hit[], current: Hit | null) {
    const pages = new Set([...this.marks.keys()]);
    this.marks.clear();
    for (const h of hits) {
      const m = this.marks.get(h.page) ?? { boxes: [], current: false };
      m.boxes.push(...h.boxes);
      if (h === current) m.current = true;
      this.marks.set(h.page, m);
      pages.add(h.page);
    }
    for (const n of pages) this.paintMarks(n);
  }
  /** Finds the words on every page; calls back as it goes so the first results show at once */
  async search(q: string, onHits: (hits: Hit[], done: number) => void, stop: () => boolean) {
    if (!this.doc || !this.lib) return;
    const needle = q.toLowerCase();
    const hits: Hit[] = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      if (stop()) return;
      let items = this.texts.get(n);
      if (!items) {
        const pg = await this.doc.getPage(n);
        items = (await pg.getTextContent()).items.filter((i) => typeof i.str === 'string') as TextItem[] & { vp?: Vp };
        items.vp = pg.getViewport({ scale: 1 });
        this.texts.set(n, items);
      }
      const vp = items.vp!;
      // the page's text joined, with where each item starts, so a phrase across items is found too
      let all = '';
      const starts: number[] = [];
      for (const it of items) {
        starts.push(all.length);
        all += `${it.str} `;
      }
      const low = all.toLowerCase();
      for (let at = low.indexOf(needle); at >= 0; at = low.indexOf(needle, at + needle.length)) {
        const boxes: Box[] = [];
        for (let k = 0; k < items.length; k++) {
          const s = starts[k];
          const e = s + items[k].str.length;
          if (e <= at || s >= at + needle.length) continue;
          const it = items[k];
          const t = this.lib.Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(t[2], t[3]) || it.height || 10;
          const len = Math.max(1, it.str.length);
          const from = Math.max(0, at - s) / len;
          const to = Math.min(len, at + needle.length - s) / len;
          boxes.push({ x: (t[4] + it.width * from) / vp.width, y: (t[5] - fh) / vp.height, w: (it.width * (to - from)) / vp.width, h: (fh * 1.2) / vp.height });
        }
        const snippet = all.slice(Math.max(0, at - 40), at + needle.length + 40).replace(/\s+/g, ' ').trim();
        if (boxes.length) hits.push({ page: n, snippet, boxes });
      }
      if (n % 10 === 0 || n === this.doc.numPages) onHits([...hits], n);
    }
  }
  destroy() {
    this.dead = true;
    this.io?.disconnect();
    for (const n of [...this.drawn.keys()]) this.clear(n);
    void this.doc?.destroy();
  }
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** A catalogue or data sheet shown inside the app: the PDF is read now (from the manufacturer's link through the server, or a
 *  stored copy) and kept only in this browser tab while it is open – nothing is saved. Zoom, search, go to a page, and take
 *  pages out as a PDF with the DIMO logo and watermark. When the link is broken it says so. */
export function usePdfViewer({ by, onEditLink }: { by: string; onEditLink?: (doc: PdfDoc) => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [hit, setHit] = useState(0);
  const [searched, setSearched] = useState(0);
  const [showHits, setShowHits] = useState(false);
  const [ex, setEx] = useState<{ pages: string; name: string } | null>(null);
  const [note, setNote] = useState<{ text: string; busy: boolean; bad?: boolean } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const ctl = useRef<Pages | null>(null);
  const searchId = useRef(0);

  const open = useCallback(async (d: PdfDoc) => {
    setDoc(d);
    setErr(null);
    setBytes(null);
    setPages(0);
    setPage(1);
    setPageText('1');
    setZoom(1);
    setQ('');
    setHits(null);
    setEx(null);
    setNote(null);
    try {
      setBytes(await pdfBytes(d.source));
    } catch (e) {
      setErr((e instanceof Error ? e.message : String(e)).replace(/ \(HTTP \d+\)$/, ''));
    }
  }, []);
  const close = () => {
    searchId.current += 1;
    setDoc(null);
    setBytes(null);
    setErr(null);
  };

  // the pages: opened once per PDF; zoom and search work on the open document
  const setBox = useCallback((el: HTMLDivElement | null) => {
    box.current = el;
  }, []);
  useEffect(() => {
    if (!bytes || !box.current) return;
    const p = new Pages(box.current, (n) => {
      setPage(n);
      setPageText(String(n));
    });
    ctl.current = p;
    p.open(bytes).then(setPages, (e) => setErr(`${e instanceof Error ? e.message : String(e)} – use Open in new tab.`));
    return () => {
      p.destroy();
      if (ctl.current === p) ctl.current = null;
    };
  }, [bytes]);
  useEffect(() => ctl.current?.setZoom(zoom), [zoom]);
  useEffect(() => {
    const h = hits?.[hit] ?? null;
    ctl.current?.setMarks(hits ?? [], h);
  }, [hits, hit]);

  const zoomBy = (dir: 1 | -1) => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + dir))] ?? 1);
  const goTo = (n: number) => {
    const t = Math.min(Math.max(1, Math.round(n) || 1), pages || 1);
    ctl.current?.goTo(t);
    setPage(t);
    setPageText(String(t));
  };
  const find = async () => {
    const text = q.trim();
    if (!text || !ctl.current) return setHits(null);
    const id = ++searchId.current;
    setHits([]);
    setHit(0);
    setSearched(0);
    setShowHits(true);
    let first = true;
    await ctl.current.search(
      text,
      (h, done) => {
        if (id !== searchId.current) return;
        setHits(h);
        setSearched(done);
        if (first && h.length) {
          first = false;
          ctl.current?.goTo(h[0].page);
        }
      },
      () => id !== searchId.current,
    );
  };
  const step = (dir: 1 | -1) => {
    if (!hits?.length) return;
    const k = (hit + dir + hits.length) % hits.length;
    setHit(k);
    ctl.current?.goTo(hits[k].page);
  };
  // the app's dialogs open behind this window, so the viewer shows its own messages and form
  const run = async (what: string, fn: () => Promise<void>) => {
    setNote({ text: `${what}…`, busy: true });
    try {
      await fn();
      setNote({ text: 'Done – saved or shared', busy: false });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), busy: false, bad: true });
    }
  };
  const extract = () =>
    run('Making the PDF', async () => {
      if (!bytes || !doc) return;
      const list = parsePages(ex?.pages ?? '', pages);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const out = await PDFDocument.create();
      for (const pg of await out.copyPages(src, list.map((n) => n - 1))) out.addPage(pg);
      const marked = await watermarkPdf(await out.save(), by);
      await deliver(marked, `${(ex?.name || doc.title).trim()} - DIMO`, 'catalog_extract', `${doc.title} p${ex?.pages}`);
      setEx(null);
    });

  const google = doc?.link ? `https://docs.google.com/viewer?url=${encodeURIComponent(doc.link)}` : null;
  const field = { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 14, color: colors.ink, backgroundColor: '#fff' };
  const viewer = (
    <Modal visible={!!doc} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, width: '100%', maxWidth: 1200, alignSelf: 'center', height: err ? undefined : '96%', gap: 8 }}>
          <Row gap={8} wrap style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1, minWidth: 200 }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} numberOfLines={1}>{doc?.title ?? ''}</Text>
              <Muted>{doc && 'path' in doc.source ? 'Stored copy' : 'From the manufacturer’s link – read now, not stored'}</Muted>
            </View>
            <Row gap={6} wrap style={{ flexShrink: 1, alignItems: 'center' }}>
              {bytes && pages && doc ? <Button small variant="secondary" title="Take pages out" onPress={() => setEx({ pages: String(page), name: `${doc.title} - p${page}` })} /> : null}
              {bytes && doc ? <Button small variant="secondary" title="Share with DIMO watermark" onPress={() => run('Adding the DIMO watermark', () => shareWatermarked(doc.source, doc.title, by))} /> : null}
              {bytes ? <Button small variant="ghost" title="Open in new tab ↗" onPress={() => window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), '_blank', 'noopener')} /> : null}
              <Button small variant="ghost" title="Close" onPress={close} />
            </Row>
          </Row>
          {bytes && pages ? (
            <Row gap={6} wrap style={{ alignItems: 'center' }}>
              <Button small variant="ghost" title="−" onPress={() => zoomBy(-1)} />
              <Text style={{ minWidth: 44, textAlign: 'center', color: colors.ink, fontSize: 13 }}>{`${Math.round(zoom * 100)}%`}</Text>
              <Button small variant="ghost" title="+" onPress={() => zoomBy(1)} />
              <Text style={{ color: colors.muted, marginLeft: 8 }}>Page</Text>
              <TextInput value={pageText} onChangeText={setPageText} onSubmitEditing={() => goTo(Number(pageText))} onBlur={() => setPageText(String(page))} keyboardType="number-pad" style={[field, { width: 56, textAlign: 'center' }]} />
              <Text style={{ color: colors.muted }}>{`of ${pages}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8, flexGrow: 1, flexShrink: 1, minWidth: 220 }}>
                <TextInput value={q} onChangeText={setQ} onSubmitEditing={find} placeholder="Search in the PDF" returnKeyType="search" style={[field, { flex: 1, minWidth: 120 }]} />
                <Button small variant="secondary" title="Find" onPress={find} />
                {hits ? (
                  <>
                    <Text style={{ color: colors.ink, fontSize: 13 }} onPress={() => setShowHits((s) => !s)}>
                      {hits.length ? `${hit + 1} of ${hits.length}${searched < pages ? '…' : ''}` : searched < pages ? `Searching… ${searched}/${pages}` : 'Not found'}
                    </Text>
                    <Button small variant="ghost" title="‹" onPress={() => step(-1)} />
                    <Button small variant="ghost" title="›" onPress={() => step(1)} />
                    {hits.length ? <Button small variant="ghost" title={showHits ? 'Hide list' : 'List'} onPress={() => setShowHits((s) => !s)} /> : null}
                  </>
                ) : null}
              </View>
            </Row>
          ) : null}
          {ex ? (
            <View style={{ gap: 6, padding: 10, borderRadius: 8, backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.line }}>
              <Text style={{ fontWeight: '600', color: colors.ink }}>Take pages out</Text>
              <Muted>{`The pages become a PDF of their own with the DIMO logo, the DIMO Lighting Solutions watermark and your name – to save or share with a client. Pages 1 to ${pages}.`}</Muted>
              <Row gap={6} wrap style={{ alignItems: 'center' }}>
                <Text style={{ color: colors.muted }}>Pages</Text>
                <TextInput value={ex.pages} onChangeText={(v) => setEx({ ...ex, pages: v })} placeholder="e.g. 5-8, 12" style={[field, { width: 140 }]} />
                <Text style={{ color: colors.muted }}>File name</Text>
                <TextInput value={ex.name} onChangeText={(v) => setEx({ ...ex, name: v })} style={[field, { flex: 1, minWidth: 180 }]} />
                <Button small title="Make PDF" onPress={extract} />
                <Button small variant="ghost" title="Cancel" onPress={() => setEx(null)} />
              </Row>
            </View>
          ) : null}
          {note ? (
            <Row gap={8} style={{ alignItems: 'center' }}>
              {note.busy ? <ActivityIndicator color={colors.red} /> : null}
              <Text style={{ color: note.bad ? colors.red : colors.ink, flexShrink: 1 }}>{note.text}</Text>
              {note.busy ? null : <Button small variant="ghost" title="OK" onPress={() => setNote(null)} />}
            </Row>
          ) : null}
          {err ? (
            <View style={{ gap: 8 }}>
              <Notice tone={colors.red}>{/^Link not available/.test(err) ? err : `Link not available – update the link. (${err})`}</Notice>
              <Muted>The manufacturer may have moved the file. Open their site to find the new link{onEditLink ? ', then update it here' : ' and ask the Design team to update it'}.</Muted>
              <Row gap={6} wrap>
                {doc?.link ? <Button small variant="secondary" title="Try the manufacturer’s link ↗" onPress={() => openLink(doc.link as string)} /> : null}
                {google ? <Button small variant="ghost" title="Try Google’s viewer ↗" onPress={() => openLink(google)} /> : null}
                {onEditLink && doc ? <Button small title="Update the link" onPress={() => { const d = doc; close(); onEditLink(d); }} /> : null}
              </Row>
            </View>
          ) : bytes ? (
            <View style={{ flex: 1, flexDirection: 'row', gap: 8, minHeight: 0 }}>
              <div ref={setBox} style={{ flex: 1, minWidth: 0, overflow: 'auto', background: '#525659', padding: 10, borderRadius: 8, WebkitOverflowScrolling: 'touch' } as CSSProperties} />
              {showHits && hits?.length ? (
                <View style={{ width: 260, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }}>
                  <div style={{ overflow: 'auto', height: '100%' }}>
                    {hits.slice(0, 500).map((h, k) => (
                      <div
                        key={`${h.page}-${k}`}
                        onClick={() => {
                          setHit(k);
                          ctl.current?.goTo(h.page);
                        }}
                        style={{ padding: '7px 9px', borderBottom: `1px solid ${colors.line}`, cursor: 'pointer', background: k === hit ? '#FFF4D6' : '#fff', font: '12px system-ui, sans-serif', color: colors.text }}
                      >
                        <b>{`p ${h.page}`}</b>
                        {` · ${h.snippet}`}
                      </div>
                    ))}
                  </div>
                </View>
              ) : null}
              {!pages ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <ActivityIndicator color={colors.red} />
              <Muted>{doc && 'path' in doc.source ? 'Opening…' : 'Reading the PDF from the manufacturer’s site…'}</Muted>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
  return { open, viewer };
}
