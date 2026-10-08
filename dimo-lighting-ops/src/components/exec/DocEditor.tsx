import { Card, colors, Muted, Notice } from '@/components/ui';
import type { PageSetup } from '@/lib/qaReport';

export type DocEditorProps = {
  /** Changing it reloads the document into the editor */
  docKey: string;
  initialHtml: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  /** Project header drawn at the top of the page */
  header: string;
  setup: PageSetup;
  /** Ready-made blocks to insert, e.g. the readings of a recorded test */
  snippets?: { key: string; label: string; html: string }[];
};

/** Phone app: the A4 editor works on the website (computer or tablet browser); here the report is read and downloaded as PDF. */
export function DocEditor({ readOnly }: DocEditorProps) {
  return (
    <Card>
      <Notice tone={colors.blue}>{readOnly ? 'Open the PDF to read the report.' : 'Write and edit test reports on the website (dimo-lighting-ops.vercel.app) on a computer or tablet – the A4 editor needs a browser.'}</Notice>
      <Muted>Drafts saved there appear here; the PDF can be downloaded from this screen.</Muted>
    </Card>
  );
}
