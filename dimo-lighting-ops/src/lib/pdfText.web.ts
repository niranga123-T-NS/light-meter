// Text of a PDF in the browser (pdf.js from /vendor/pdfjs), one line per table row – for reading uploaded reports.
type Item = { str: string; transform: number[] };
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (o: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Item[] }> }> }> };
};
const w = () => window as unknown as { pdfjsLib?: PdfJs };

let ready: Promise<PdfJs> | null = null;
function load() {
  ready ??= new Promise<PdfJs>((resolve, reject) => {
    if (w().pdfjsLib) return resolve(w().pdfjsLib!);
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      const lib = w().pdfjsLib;
      if (!lib) return reject(new Error('PDF reader did not load'));
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => reject(new Error('PDF reader did not load'));
    document.head.appendChild(s);
  });
  return ready;
}

export async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const lib = await load();
  const doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    // group the pieces by their height on the page, left to right
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str.trim() }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => out.push(r.sort((a, b) => a.x - b.x).map((x) => x.s).join(' ')));
  }
  return out.join('\n');
}
