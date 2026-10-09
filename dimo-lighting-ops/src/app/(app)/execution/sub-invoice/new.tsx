import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Select } from '@/components/ui';
import { SINV_NOTICE } from '@/lib/execution';
import { fmtMoney, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Cert = { id: string; code: string; subcontractor: string; period: string; net: number; status: string; var_code: string | null };

/** Record a subcontractor invoice against a verified payment certificate (IPC + measurement sheets); the copy is attached next. */
export default function NewSubInvoice() {
  const { project, cert: preset } = useLocalSearchParams<{ project: string; cert?: string }>();
  const dialog = useDialog();
  const [f, setF] = useState({ cert: preset ?? '', invoice_no: '', invoice_date: todayISO(), amount: '', note: '' });
  const { data, error } = useLoad(() => rpc<Cert[]>('sub_invoice_certs', { p_exec: project }), [project]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const cert = data.find((c) => c.id === f.cert);
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Record a subcontractor invoice' }} />
      <Notice tone={colors.blue}>{SINV_NOTICE}</Notice>
      {!data.length ? (
        <Notice tone={colors.amber}>
          No payment certificate with Interim Payment Approval (IPA) yet. Submit the IPC with its measurement sheets first – the invoice is recorded once the IPC has IPA.
        </Notice>
      ) : (
        <Card>
          <Select
            label="Payment certificate (IPC) with IPA"
            required
            value={f.cert}
            onChange={(v) => setF((s) => ({ ...s, cert: v, amount: s.amount || String(data.find((c) => c.id === v)?.net ?? '') }))}
            options={data.map((c) => ({ value: c.id, label: `${c.code} · ${c.var_code ? `Variation ${c.var_code}` : 'BOQ work'} · ${c.subcontractor} · ${c.period} · net ${fmtMoney(c.net, 'LKR')}` }))}
          />
          <Field label="Invoice number" required value={f.invoice_no} onChangeText={(v) => setF((s) => ({ ...s, invoice_no: v }))} />
          <DateField label="Invoice date" required value={f.invoice_date} onChange={(v) => setF((s) => ({ ...s, invoice_date: v ?? '' }))} quick={[0, -1]} />
          <Field
            label="Invoice amount (LKR)"
            required
            keyboardType="decimal-pad"
            value={f.amount}
            onChangeText={(v) => setF((s) => ({ ...s, amount: v }))}
            hint={cert ? `Certified net ${fmtMoney(cert.net, 'LKR')}` : undefined}
          />
          <Field label="Note" multiline value={f.note} onChangeText={(v) => setF((s) => ({ ...s, note: v }))} />
          <Muted>Next: attach the invoice copy, the IPA-approved IPC with signatures, and the corrected (final) measurement sheets – then submit.</Muted>
          <Row gap={8} style={{ marginTop: 8 }}>
            <Button
              title="Continue – attach the documents"
              disabled={!data.some((c) => c.id === f.cert) || !f.invoice_no.trim() || !f.amount}
              onPress={() =>
                dialog.run(async () => {
                  const id = await rpc<string>('create_sub_invoice', { p_cert: f.cert, p: { invoice_no: f.invoice_no, invoice_date: f.invoice_date, amount: f.amount, note: f.note } });
                  router.replace(`/execution/sub-invoice/${id}`);
                })
              }
            />
            <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
          </Row>
        </Card>
      )}
    </Screen>
  );
}
