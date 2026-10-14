import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Notice, Row } from '@/components/ui';
import { openLink, pdfBytes, shareWatermarked, type PdfDoc } from '@/lib/catalog';

/** A catalogue or data sheet shown inside the app: the PDF is read now (from the manufacturer's link through the server, or a
 *  stored copy) and kept only in this browser tab while it is open – nothing is saved. When the link is broken it says so. */
export function usePdfViewer({ by, onEditLink }: { by: string; onEditLink?: (doc: PdfDoc) => void }) {
  const dialog = useDialog();
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = useCallback(async (d: PdfDoc) => {
    setDoc(d);
    setUrl(null);
    setErr(null);
    try {
      const bytes = await pdfBytes(d.source);
      setUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })));
    } catch (e) {
      setErr((e instanceof Error ? e.message : String(e)).replace(/ \(HTTP \d+\)$/, ''));
    }
  }, []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const close = () => {
    setDoc(null);
    setUrl(null);
    setErr(null);
  };
  const google = doc?.link ? `https://docs.google.com/viewer?url=${encodeURIComponent(doc.link)}` : null;
  const viewer = (
    <Modal visible={!!doc} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, width: '100%', maxWidth: 1100, alignSelf: 'center', height: err ? undefined : '96%', gap: 8 }}>
          <Row gap={8} wrap style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.ink }} numberOfLines={1}>{doc?.title ?? ''}</Text>
              <Muted>{doc && 'path' in doc.source ? 'Stored copy' : 'From the manufacturer’s link – read now, not stored'}</Muted>
            </View>
            <Row gap={6} wrap>
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
          ) : url ? (
            <iframe title={doc?.title ?? 'PDF'} src={url} style={{ flex: 1, width: '100%', border: '1px solid #ddd', borderRadius: 8 }} />
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
