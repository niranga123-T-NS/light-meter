import type { useDialog } from '@/components/dialog';
import { rpc } from './supabase';

/** Inquiries that still count for the project's win % (no result recorded) */
export const OPEN_INQUIRY = (s: string) => !['won', 'lost', 'cancelled', 'rejected'].includes(s);

type Dialog = ReturnType<typeof useDialog>;
type Inq = { id: string; code: string; inquiry_name?: string | null; win_probability?: number | null; est_value?: number | null; currency?: string | null };

/** Set one inquiry's win % (and the value expected from it); the project's % follows. Returns the project's new %. */
export async function editInquiryWin(dialog: Dialog, i: Inq, done?: (projectPct: number) => void) {
  const r = await dialog.prompt({
    title: `Win probability – ${i.code}${i.inquiry_name ? ` · ${i.inquiry_name}` : ''}`,
    message: 'Your estimate of winning this inquiry. The project’s % is worked out from its open inquiries (weighted by value).',
    fields: [
      { key: 'pct', label: 'Win probability %', required: true, initial: i.win_probability != null ? String(i.win_probability) : '' },
      { key: 'value', label: `Expected value of this inquiry (${i.currency ?? 'LKR'}) – the quoted value replaces it once released`, initial: i.est_value != null ? String(i.est_value) : '' },
    ],
    confirmLabel: 'Save',
  });
  if (!r) return;
  const pct = Number(r.pct);
  if (!(pct >= 0 && pct <= 100)) return dialog.toast('Win probability is 0 – 100', 'error');
  const value = r.value?.trim() ? Number(r.value.replace(/,/g, '')) : null;
  await dialog.run(async () => {
    const p = await rpc<number>('set_inquiry_probability', { p_inquiry: i.id, p_pct: pct, p_value: value });
    done?.(p);
  }, 'Saved – the project’s win probability is updated');
}
