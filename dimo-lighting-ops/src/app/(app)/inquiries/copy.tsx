import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { CustomerPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Inquiry, Quotation } from '@/lib/types';

/** Same project, another main contractor: the released quotation is reused – SM Estimation issues it to the new contractor. */
export default function QuoteAnotherContractor() {
  const { from } = useLocalSearchParams<{ from: string }>();
  const dialog = useDialog();
  const [org, setOrg] = useState<{ organizationId: string | null; unitId: string | null; contactId: string | null }>({ organizationId: null, unitId: null, contactId: null });
  const [deadline, setDeadline] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadErr } = useLoad(async () => {
    const [{ data: i }, { data: q }] = await Promise.all([
      supabase.from('inquiries').select('*').eq('id', from).single(),
      supabase.from('quotations').select('*').eq('inquiry_id', from).order('released_at', { ascending: false }).limit(1),
    ]);
    const inq = i as Inquiry;
    const group = inq?.tender_group_id
      ? ((await supabase.from('inquiries').select('id, code, customer_name, status').eq('tender_group_id', inq.tender_group_id)).data ?? [])
      : [];
    return { i: inq, q: ((q ?? []) as Quotation[])[0] ?? null, group: group as Pick<Inquiry, 'id' | 'code' | 'customer_name' | 'status'>[] };
  }, [from]);
  if (!data) return <Screen>{loadErr ? <ErrorBanner message={loadErr} /> : <Loading />}</Screen>;
  const { i, q, group } = data;

  const save = () => {
    setError(null);
    if (!org.organizationId) return setError('Choose the contractor');
    return dialog.run(async () => {
      const id = await rpc<string>('copy_quotation_to_contractor', {
        p_inquiry: i.id,
        p_organization: org.organizationId,
        p_unit: org.unitId,
        p_contact: org.contactId,
        p_deadline: deadline,
        p_note: note || null,
      });
      router.replace(`/inquiries/${id}`);
    }, 'Sent to SM Estimation to issue the quotation');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Quote to another contractor' }} />
      <ErrorBanner message={error} />
      <Notice tone={colors.blue}>
        {`${i.project_name} · quotation ${q ? `${q.full_no} – ${fmtMoney(q.quoted_value, q.currency)}` : ''} to ${i.customer_name}. The same estimate is reused – no new design or estimation. SM Estimation uploads the quotation addressed to the new contractor and releases it with its own quotation number.`}
      </Notice>
      {group.length ? <Muted>{`Already in this tender: ${group.map((g) => `${g.customer_name} (${g.code})`).join(' · ')}`}</Muted> : null}
      <Section title="New contractor">
        <Card>
          <CustomerPicker organizationId={org.organizationId} unitId={org.unitId} contactId={org.contactId} onChange={(c) => setOrg({ organizationId: c.organizationId, unitId: c.unitId, contactId: c.contactId })} />
          <DateField label="Contractor's deadline" value={deadline} onChange={setDeadline} quick={[1, 3, 7]} hint={i.customer_deadline ? `Leave blank to use ${fmtDate(i.customer_deadline)}` : undefined} />
          <Field label="Note to SM Estimation" multiline value={note} onChangeText={setNote} hint="e.g. same scope; address to the contractor's procurement manager" />
          <Muted>The new contractor goes through the debtor check. If this contractor needs a different price, request a revised quotation on it after it is released.</Muted>
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title="Create quotation for this contractor" onPress={save} />
      </Row>
    </Screen>
  );
}
