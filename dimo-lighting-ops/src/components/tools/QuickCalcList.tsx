import { router } from 'expo-router';
import { DataTable } from '@/components/DataTable';
import { Button, ErrorBanner, Loading, Muted, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Row_ = { id: string; code: string; title: string; created_by: string; created_at: string; results: { kind?: 'road'; em?: number; count?: number; uo?: number; savings?: { lkr?: number | null } | null } };

/** DLux lighting calculations: start a new one; my saved ones (managers and the Design team see everyone's) */
export function QuickCalcList() {
  const me = useMe();
  const people = usePeople();
  const { data, error } = useLoad(async () => {
    const { data: q, error: e } = await supabase.from('quick_calcs').select('id, code, title, created_by, created_at, results').order('created_at', { ascending: false }).limit(300);
    if (e) throw new Error(e.message);
    return (q ?? []) as Row_[];
  }, []);
  const tariffs = ['sm_projects', 'gm', 'design_manager', 'sys_admin'].includes(me.role);
  return (
    <>
      <Row gap={8} wrap>
        <Button title="+ Indoor (DLux)" onPress={() => router.push('/tools/calc/new')} />
        <Button title="+ Road lighting" onPress={() => router.push('/tools/road/new')} />
        <Button variant="secondary" title={tariffs ? 'Tariffs (set the rates)' : 'Tariffs'} onPress={() => router.push('/tools/tariffs')} />
      </Row>
      <Muted>Indoor rooms or roads (EN 13201): layout, result and savings in a few minutes – share a DRAFT sheet with the client and turn it into an inquiry for the Design team.</Muted>
      {!data ? (
        error ? <ErrorBanner message={error} /> : <Loading />
      ) : (
        <DataTable
          rows={data}
          keyOf={(r) => r.id}
          onPress={(r) => router.push(r.results?.kind === 'road' ? `/tools/road/${r.id}` : `/tools/calc/${r.id}`)}
          emptyTitle="No calculations yet"
          columns={[
            { h: 'Calculation', w: 260, grow: true, v: (r) => `${r.title}\n${r.code}${r.created_by !== me.id ? ` · ${people[r.created_by]?.full_name ?? ''}` : ''}` },
            { h: 'Type', w: 70, v: (r) => (r.results?.kind === 'road' ? 'Road' : 'Indoor') },
            { h: 'Fittings', w: 80, right: true, v: (r) => (r.results?.kind === 'road' ? '—' : String(r.results?.count ?? '—')) },
            { h: 'Average', w: 90, right: true, v: (r) => (r.results?.em != null ? `${Math.round(r.results.em)} lx` : '—') },
            { h: 'Uo', w: 60, right: true, v: (r) => (r.results?.uo != null ? r.results.uo.toFixed(2) : '—') },
            { h: 'Saved', w: 140, v: (r) => fmtDateTime(r.created_at) },
          ]}
        />
      )}
    </>
  );
}
