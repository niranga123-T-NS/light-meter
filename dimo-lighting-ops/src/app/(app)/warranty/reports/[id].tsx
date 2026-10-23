import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { ReportedLocationRow } from '@/components/ReportedLocation';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { WarrantyReport } from '@/lib/types';
import { isWarrantyDesk, phoneIn } from '@/lib/warranty';

/** One warranty issue reported from a sales visit: everything the sales person entered, the photos and the shared location */
export default function WarrantyReportPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('warranty_reports').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return r as WarrantyReport;
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const r = data, tel = phoneIn(r.site_contact), desk = isWarrantyDesk(me.role);
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: r.code ?? 'Warranty issue' }} />
      <Card style={{ gap: 6 }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{`${r.customer}${r.project_name ? ` · ${r.project_name}` : ''}`}</Text>
          <Pill label={r.status === 'reported' ? 'Waiting for a claim' : r.status === 'converted' ? 'Claim opened' : 'Closed'} tone={r.status === 'reported' ? colors.amber : r.status === 'converted' ? colors.green : colors.grey} />
        </Row>
        <Text style={{ color: colors.ink }}>{r.description}</Text>
        <Row wrap>
          {r.quantity != null ? <KeyValue label="Approx. quantity" value={String(r.quantity)} /> : null}
          <KeyValue label="Location on site" value={r.location || '—'} />
          <KeyValue label="Customer contact on site" value={r.site_contact || '—'} />
          <ReportedLocationRow lat={r.rep_lat ?? null} lng={r.rep_lng ?? null} from={r.rep_from} label="Location shared by the sales person" />
          <KeyValue label="Reported" value={`${fmtDateTime(r.created_at)} · ${people[r.sales_person_id]?.full_name ?? '—'}`} />
          {r.dismiss_reason ? <KeyValue label="Closed" value={r.dismiss_reason} /> : null}
        </Row>
        <Row wrap gap={8}>
          {tel ? <Button small variant="secondary" title={`Call ${tel}`} onPress={() => Linking.openURL(`tel:${tel}`)} /> : null}
          {r.visit_id ? <Button small variant="ghost" title="Open the visit" onPress={() => router.push(`/visits/${r.visit_id}`)} /> : null}
          {r.claim_id ? <Button small title="Open the claim" onPress={() => router.push(`/warranty/claims/${r.claim_id}`)} /> : null}
          {desk && r.status === 'reported' ? (
            <>
              <Button small title="Enter claim" onPress={() => router.push({ pathname: '/warranty/claims/new', params: { report: r.id } })} />
              <Button
                small
                variant="ghost"
                title="Close without a claim"
                onPress={async () => {
                  const x = await dialog.prompt({ title: 'Close this report without a claim', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }] });
                  if (x) await dialog.run(async () => { await rpc('dismiss_warranty_report', { p_id: r.id, p_reason: x.r }); await reload(); }, 'Closed – sales person told');
                }}
              />
            </>
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="warranty_report" entityId={r.id} kinds={['report_photo']} title="Photos from the visit" canUpload={r.sales_person_id === me.id} allowCamera />
      {!r.site_contact ? <Muted style={{ marginTop: 6 }}>No site contact was entered – ask {people[r.sales_person_id]?.full_name ?? 'the sales person'}.</Muted> : null}
    </Screen>
  );
}
