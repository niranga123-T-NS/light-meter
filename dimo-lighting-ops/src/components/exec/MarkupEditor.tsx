import { Card, colors, Muted, Notice } from '@/components/ui';

export type MarkupEditorProps = {
  /** The document to mark up: a PDF or a photo (JPG / PNG) */
  bytes: ArrayBuffer;
  mime: string;
  fileName: string;
  /** Written small in red at the foot of the first page, e.g. "Thiloshan N. · 09 Oct 2026" */
  signature: string;
  onSave: (pdf: Uint8Array) => Promise<void>;
  onCancel: () => void;
};

/** Phone app: marking up a copy works on the website (computer or tablet browser); the marked-up PDF is read here. */
export function MarkupEditor(_: MarkupEditorProps) {
  return (
    <Card>
      <Notice tone={colors.blue}>Mark up the copy on the website (dimo-lighting-ops.vercel.app) on a computer or tablet – the red pen needs a browser.</Notice>
      <Muted>The marked-up PDF then appears with the invoice here as well.</Muted>
    </Card>
  );
}
