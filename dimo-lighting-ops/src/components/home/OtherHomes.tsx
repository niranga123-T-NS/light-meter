import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { MeetingActions } from '@/components/MeetingActions';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { Button, Card, colors, ErrorBanner, Grid, H1, ListRow, Muted, Row, Screen, Section, Stat } from '../ui';

/** Operations Executive home: debtors upload status and the samples queue (Sections 12, 13). */
export function OpsHome() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [uploads, debts, samples] = await Promise.all([
      supabase.from('debt_uploads').select('as_at, status, confirmed_at').eq('status', 'confirmed').order('as_at', { ascending: false }).limit(1),
      supabase.from('debts').select('id, client_name, invoice_no, amount, currency, is_legal, legal_outcome, next_hearing_date, collection_mismatch').not('status', 'in', '(collected_confirmed,cleared)'),
      supabase.from('samples').select('status, expected_return_date'),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const d = debts.data ?? [];
    const s = samples.data ?? [];
    return {
      lastUpload: uploads.data?.[0]?.as_at ?? null,
      lkr: d.filter((x) => x.currency === 'LKR').reduce((a, x) => a + Number(x.amount), 0),
      usd: d.filter((x) => x.currency === 'USD').reduce((a, x) => a + Number(x.amount), 0),
      legal: d.filter((x) => x.is_legal).length,
      hearings: d.filter((x) => x.is_legal && x.next_hearing_date && x.next_hearing_date <= today).length,
      // Legal cases whose hearing date has passed without an update (alerted every day)
      passed: d.filter((x) => x.is_legal && !x.legal_outcome && x.next_hearing_date && x.next_hearing_date < today),
      mismatches: d.filter((x) => x.collection_mismatch).length,
      toCheck: s.filter((x) => x.status === 'submitted').length,
      toDispatch: s.filter((x) => x.status === 'approved').length,
      out: s.filter((x) => x.status === 'out').length,
      overdue: s.filter((x) => x.status === 'out' && x.expected_return_date && x.expected_return_date < today).length,
      toConfirm: s.filter((x) => x.status === 'return_reported' || x.status === 'damaged_lost').length,
      soldUnpaid: s.filter((x) => x.status === 'sold_unpaid').length,
    };
  });
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Operations' }} />
      <H1>Operations</H1>
      <ErrorBanner message={error} />
      <Row wrap gap={8} style={{ marginTop: 8 }}>
        <Button title="Upload debtors list" icon="⇪" onPress={() => router.push('/debtors/upload')} />
        <Button title="Samples queue" variant="secondary" onPress={() => router.push('/samples')} />
      </Row>
      <MeetingActions />
      {data?.passed.length ? (
        <Card style={{ borderColor: colors.red, borderWidth: 2, marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: 12, backgroundColor: '#FDECEC' }}>
            <Text style={{ fontWeight: '800', color: colors.red }}>Hearing date passed – update {data.passed.length} legal case{data.passed.length === 1 ? '' : 's'}</Text>
            <Muted>Enter the status, next hearing date and comments. A reminder is sent every day until each case is updated.</Muted>
          </View>
          {data.passed.map((x) => (
            <ListRow
              key={x.id}
              highlight={colors.red}
              title={`${x.client_name ?? ''} · ${x.invoice_no}`}
              subtitle={`Hearing was ${fmtDate(x.next_hearing_date)} · ${fmtMoney(x.amount, x.currency)}`}
              right={<Text style={{ color: colors.red, fontWeight: '700' }}>Update ›</Text>}
              onPress={() => router.push(`/debtors/${x.id}`)}
            />
          ))}
        </Card>
      ) : null}
      {data ? (
        <>
          <Section title="Debtors">
            <Grid min={170}>
              <Stat label="Last upload" value={fmtDate(data.lastUpload)} />
              <Stat label="Outstanding LKR" value={fmtMoney(data.lkr, 'LKR')} />
              <Stat label="Outstanding USD" value={fmtMoney(data.usd, 'USD')} />
              <Stat label="Legal cases" value={data.legal} onPress={() => router.push('/debtors?filter=legal')} />
              <Stat label="Hearing date passed – update" value={data.passed.length} tone={data.passed.length ? 'red' : undefined} onPress={() => router.push('/debtors?filter=hearing')} />
              <Stat label="Collection mismatches" value={data.mismatches} tone={data.mismatches ? 'amber' : undefined} onPress={() => router.push('/debtors?filter=mismatch')} />
            </Grid>
          </Section>
          <Section title="Samples">
            <Grid min={170}>
              <Stat label="Availability to check" value={data.toCheck} tone={data.toCheck ? 'amber' : undefined} onPress={() => router.push('/samples?tab=check')} />
              <Stat label="Approved – to dispatch" value={data.toDispatch} onPress={() => router.push('/samples?tab=dispatch')} />
              <Stat label="Out – due for return" value={data.out} onPress={() => router.push('/samples?tab=out')} />
              <Stat label="Overdue" value={data.overdue} tone={data.overdue ? 'red' : undefined} onPress={() => router.push('/samples?tab=out')} />
              <Stat label="Returns to confirm & clear" value={data.toConfirm} tone={data.toConfirm ? 'amber' : undefined} onPress={() => router.push('/samples?tab=confirm')} />
              <Stat label="Sold – unpaid" value={data.soldUnpaid} onPress={() => router.push('/samples?tab=sold')} />
            </Grid>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

export function AdminHome() {
  const me = useMe();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Home' }} />
      <H1>Welcome, {me.full_name}</H1>
      <Muted>{ROLE_LABELS[me.role]}</Muted>
      <Section title="Administration">
        <Card>
          <Muted>
            Maintain users and roles, master lists, SLA rules, holidays, exchange rates, brands and competitors. You do not see commercial values unless
            granted.
          </Muted>
          <Row style={{ marginTop: 12 }}>
            <Button title="Open administration" onPress={() => router.push('/admin')} />
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
