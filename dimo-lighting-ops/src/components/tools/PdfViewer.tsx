import { useCallback } from 'react';
import { openCatalogFile, openLink, type PdfDoc } from '@/lib/catalog';

/** On the phone a catalogue or data sheet opens in the phone's own PDF viewer: the manufacturer's link, or a stored copy */
export function usePdfViewer(_opts: { by: string; onEditLink?: (doc: PdfDoc) => void }) {
  const open = useCallback(async (doc: PdfDoc) => {
    if ('path' in doc.source) await openCatalogFile(doc.source.path, doc.fileName);
    else if (doc.link) await openLink(doc.link);
  }, []);
  return { open, viewer: null };
}
