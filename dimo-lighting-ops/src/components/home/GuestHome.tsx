import { Stack } from 'expo-router';
import { Card, ErrorBanner, H2, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** A person from outside with temporary high level access, outside the access period: when it starts, or that it has ended */
export function GuestHome() {
  const me = useMe();
  const { data, error } = useLoad(async () => {
    const { data: g, error: e } = await supabase
      .from('high_level_grants')
      .select('id, starts_at, ends_at, reason')
      .eq('user_id', me.id)
      .is('cancelled_at', null)
      .gt('ends_at', new Date().toISOString())
      .order('starts_at')
      .limit(5);
    if (e) throw new Error(e.message);
    return (g ?? []) as { id: string; starts_at: string; ends_at: string; reason: string }[];
  }, [me.id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return (
    <Screen maxWidth={700}>
      <Stack.Screen options={{ title: 'High level access' }} />
      <Card style={{ gap: 6 }}>
        <H2>{`Welcome, ${me.full_name}`}</H2>
        <Muted>
          You have temporary high level access (view only) to DIMO Lighting Operations, given by the GM / DGM. During the period you see everything the GM / DGM sees; you
          cannot change or approve anything. Outside the period there is nothing to see.
        </Muted>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {data.length ? (
          data.map((g) => <ListRow key={g.id} title={`From ${fmtDateTime(g.starts_at)} to ${fmtDateTime(g.ends_at)}`} subtitle={g.reason} />)
        ) : (
          <ListRow title="Your access period has ended" subtitle="Ask the GM / DGM if you need access again." />
        )}
      </Card>
      <Muted>The view opens by itself within a few minutes of the start – or reload the page.</Muted>
    </Screen>
  );
}
