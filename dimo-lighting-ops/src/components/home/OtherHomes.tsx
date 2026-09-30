import { router, Stack } from 'expo-router';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorBanner, Grid, H1, Muted, Row, Screen, Section, Stat } from '../ui';

/** Operations Executive home: debtors upload status and the samples queue (Sections 12, 13). */
export function OpsHome() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [uploads, debts, samples] = await Promise.all([
      supabase.from('debt_uploads').select('as_at, status, confirmed_at').eq('status', 'confirmed').order('as_at', { ascending: false }).limit(1),
      supabase.from('debts').select('amount, currency, is_legal, next_hearing_date, collection_mismatch').not('status', 'in', '(collected_confirmed,cleared)'),
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
      mismatches: d.filter((x) => x.collection_mismatch).length,
      toCheck: s.filter((x) => x.status === 'submitted').length,
      toDispatch: s.filter((x) => x.status === 'approved').length,
      out: s.filter((x) => x.status === 'out').length,
      overdue: s.filter((x) => x.status === 'out' && x.expected_return_date && x.expected_return_date < today).length,
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
      {data ? (
        <>
          <Section title="Debtors">
            <Grid min={170}>
              <Stat label="Last upload" value={fmtDate(data.lastUpload)} />
              <Stat label="Outstanding LKR" value={fmtMoney(data.lkr, 'LKR')} />
              <Stat label="Outstanding USD" value={fmtMoney(data.usd, 'USD')} />
              <Stat label="Legal cases" value={data.legal} onPress={() => router.push('/debtors?filter=legal')} />
              <Stat label="Hearing outcome to enter" value={data.hearings} tone={data.hearings ? 'red' : undefined} onPress={() => router.push('/debtors?filter=legal')} />
              <Stat label="Collection mismatches" value={data.mismatches} tone={data.mismatches ? 'amber' : undefined} onPress={() => router.push('/debtors?filter=mismatch')} />
            </Grid>
          </Section>
          <Section title="Samples">
            <Grid min={170}>
              <Stat label="Availability to check" value={data.toCheck} tone={data.toCheck ? 'amber' : undefined} onPress={() => router.push('/samples?tab=check')} />
              <Stat label="Approved – to dispatch" value={data.toDispatch} onPress={() => router.push('/samples?tab=dispatch')} />
              <Stat label="Out – due for return" value={data.out} onPress={() => router.push('/samples?tab=out')} />
              <Stat label="Overdue" value={data.overdue} tone={data.overdue ? 'red' : undefined} onPress={() => router.push('/samples?tab=out')} />
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
