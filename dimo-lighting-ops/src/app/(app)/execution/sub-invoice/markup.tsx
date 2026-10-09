import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { MarkupEditor } from '@/components/exec/MarkupEditor';
import { ErrorBanner, Loading, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { uploadAttachment } from '@/lib/files';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment } from '@/lib/types';

/** Red pen on an invoice or IPC copy (AE / SEE / Operations): the comments are saved as a marked-up PDF kept with the record. */
export default function SubInvoiceMarkup() {
  const { id, att, entity, kind } = useLocalSearchParams<{ id: string; att: string; entity?: string; kind?: string }>();
  const ipc = entity === 'sub_cert';
  const me = useMe();
  const dialog = useDialog();
  const { data, error } = useLoad(async () => {
    const { data: a, error: e } = await supabase.from('attachments').select('*').eq('id', att).single();
    if (e) throw new Error(e.message);
    const f = a as Attachment;
    const path = await rpc<string>('log_download', { p_attachment: f.id });
    const { data: u, error: ue } = await supabase.storage.from('files').createSignedUrl(path, 300);
    if (ue) throw new Error(ue.message);
    const bytes = await (await fetch(u.signedUrl)).arrayBuffer();
    const mime = f.mime_type || (/\.pdf$/i.test(f.file_name) ? 'application/pdf' : /\.png$/i.test(f.file_name) ? 'image/png' : 'image/jpeg');
    return { f, bytes, mime };
  }, [att]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const base = data.f.file_name.replace(/\.[^.]+$/, '');
  return (
    <Screen maxWidth={960}>
      <Stack.Screen options={{ title: `Mark up · ${data.f.file_name}` }} />
      <MarkupEditor
        bytes={data.bytes}
        mime={data.mime}
        fileName={data.f.file_name}
        signature={`${me.full_name} · ${fmtDate(todayISO())}`}
        onCancel={() => router.back()}
        onSave={async (pdf) => {
          await dialog.run(async () => {
            await uploadAttachment(ipc ? 'sub_cert' : 'sub_invoice', id, kind === 'jm_markup' && ipc ? 'jm_markup' : ipc ? 'ipc_markup' : 'sinv_markup', {
              name: `Marked up – ${base}.pdf`,
              uri: '',
              mimeType: 'application/pdf',
              webFile: new Blob([pdf as BlobPart], { type: 'application/pdf' }),
            });
            router.back();
          }, 'Marked-up copy saved – now approve or return');
        }}
      />
    </Screen>
  );
}
