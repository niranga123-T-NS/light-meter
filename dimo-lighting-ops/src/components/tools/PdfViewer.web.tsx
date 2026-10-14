import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Notice, Row } from '@/components/ui';
import { openLink, pdfBytes, shareWatermarked, type PdfDoc } from '@/lib/catalog';

type PjPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } };
type PjDoc = { numPages: number; getPage: (n: number) => Promise<PjPage>; destroy: () => Promise<void> };
type PjLib = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: Uint8Array }) => { promise: Promise<PjDoc> } };
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

/** Every page drawn by pdf.js (tablets and phones show only the first page of a PDF in a frame). Pages are drawn as they
 *  scroll into view and cleared when far away, so a 300-page catalogue does not run the tablet out of memory. */
function PdfPages({ bytes, zoom, onPages }: { bytes: Uint8Array; zoom: number; onPages: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let dead = false;
    let doc: PjDoc | null = null;
    let io: IntersectionObserver | null = null;
    root.innerHTML = '';
    (async () => {
      try {
        const lib = await loadPdfJs();
        doc = await lib.getDocument({ data: bytes.slice() }).promise;
        if (dead) return;
        onPages(doc.numPages);
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        const width = Math.max(200, (root.clientWidth - 16) * zoom);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const drawn = new Map<number, HTMLCanvasElement>();
        const draw = async (n: number, holder: HTMLDivElement) => {
          if (drawn.has(n) || !doc) return;
          const c = document.createElement('canvas');
          drawn.set(n, c);
          const pg = await doc.getPage(n);
          const vp1 = pg.getViewport({ scale: 1 });
          const vp = pg.getViewport({ scale: (width * dpr) / vp1.width });
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          c.style.width = '100%';
          c.style.display = 'block';
          holder.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          if (drawn.get(n) === c && !dead) holder.replaceChildren(c);
        };
        const clear = (n: number, holder: HTMLDivElement) => {
          const c = drawn.get(n);
          if (!c) return;
          drawn.delete(n);
          c.width = 0;
          c.height = 0;
          holder.replaceChildren();
        };
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const el = e.target as HTMLDivElement;
              const n = Number(el.dataset.page);
              if (e.isIntersecting) void draw(n, el);
              else clear(n, el);
            }
          },
          { root: root, rootMargin: '1500px 0px' },
        );
        for (let n = 1; n <= doc.numPages; n++) {
          const el = document.createElement('div');
          el.dataset.page = String(n);
          el.style.cssText = `width:${width}px;aspect-ratio:${first.width} / ${first.height};margin:0 auto 8px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)`;
          root.appendChild(el);
          io.observe(el);
        }
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      io?.disconnect();
      void doc?.destroy();
    };
  }, [bytes, zoom, onPages]);
  if (err) return <Notice tone={colors.red}>{`${err} – use Open in new tab.`}</Notice>;
  return <div ref={box} style={{ flex: 1, overflow: 'auto', background: '#525659', padding: 8, borderRadius: 8, WebkitOverflowScrolling: 'touch' } as React.CSSProperties} />;
}

/** A catalogue or data sheet shown inside the app: the PDF is read now (from the manufacturer's link through the server, or a
 *  stored copy) and kept only in this browser tab while it is open – nothing is saved. When the link is broken it says so. */
export function usePdfViewer({ by, onEditLink }: { by: string; onEditLink?: (doc: PdfDoc) => void }) {
  const dialog = useDialog();
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const open = useCallback(async (d: PdfDoc) => {
    setDoc(d);
    setUrl(null);
    setErr(null);
    setBytes(null);
    setZoom(1);
    setPages(0);
    try {
      const b = await pdfBytes(d.source);
      setBytes(b);
      setUrl(URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/pdf' })));
    } catch (e) {
      setErr((e instanceof Error ? e.message : String(e)).replace(/ \(HTTP \d+\)$/, ''));
    }
  }, []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const close = () => {
    setDoc(null);
    setUrl(null);
    setErr(null);
    setBytes(null);
  };
  const google = doc?.link ? `https://docs.google.com/viewer?url=${encodeURIComponent(doc.link)}` : null;
  const viewer = (
    <Modal visible={!!doc} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, width: '100%', maxWidth: 1100, alignSelf: 'center', height: err ? undefined : '96%', gap: 8 }}>
          <Row gap={8} wrap style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} numberOfLines={1}>{doc?.title ?? ''}</Text>
              <Muted>{`${doc && 'path' in doc.source ? 'Stored copy' : 'From the manufacturer’s link – read now, not stored'}${pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}`}</Muted>
            </View>
            <Row gap={6} wrap style={{ flexShrink: 1 }}>
              {bytes ? <Button small variant="ghost" title="−" onPress={() => setZoom((z) => Math.max(1, z - 0.5))} /> : null}
              {bytes ? <Button small variant="ghost" title="+" onPress={() => setZoom((z) => Math.min(3, z + 0.5))} /> : null}
              {url && doc ? <Button small variant="secondary" title="Share with DIMO watermark" onPress={() => dialog.run(() => shareWatermarked(doc.source, doc.title, by))} /> : null}
              {url ? <Button small variant="ghost" title="Open in new tab ↗" onPress={() => window.open(url, '_blank', 'noopener')} /> : null}
              <Button small variant="ghost" title="Close" onPress={close} />
            </Row>
          </Row>
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
            <PdfPages bytes={bytes} zoom={zoom} onPages={setPages} />
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
