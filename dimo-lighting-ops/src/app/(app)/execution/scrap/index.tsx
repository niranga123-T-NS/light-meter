import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Pill, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { SCRAP_METHOD, SCRAP_OPEN, SCRAP_RAISE, SCRAP_STATUS, type ScrapDisposal, type ScrapLine, type ScrapQuote } from '@/lib/scrap';
import { supabase } from '@/lib/supabase';

type Group = 'open' | 'mine' | 'disposed' | 'all';

/** Scrap disposals: what waits for approval or disposal, and the history (with the amounts received from sales). */
export default function ScrapList() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ project?: string }>();
  const approver = me.role === 'sm_projects' || me.role === 'gm';
  const [group, setGroup] = useState<Group>(approver ? 'mine' : 'open');
  const { data, error } = useLoad(async () => {
    let q = supabase.from('scrap_disposals').select('*').order('requested_at', { ascending: false });
    if (params.project) q = q.eq('exec_project_id', params.project);
    const [d, p, l, qt] = await Promise.all([
      q,
      supabase.from('exec_projects').select('id, code, name'),
      supabase.from('scrap_lines').select('disposal_id, item, unit, qty'),
      supabase.from('scrap_quotes').select('id, buyer, amount_lkr'),
    ]);
    if (d.error) throw new Error(d.error.message);
    return {
      rows: (d.data ?? []) as ScrapDisposal[],
      projects: (p.data ?? []) as Pick<ExecProject, 'id' | 'code' | 'name'>[],
      lines: (l.data ?? []) as (ScrapLine & { disposal_id: string })[],
      quotes: (qt.data ?? []) as Pick<ScrapQuote, 'id' | 'buyer' | 'amount_lkr'>[],
    };
  }, [params.project]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { rows, projects, lines, quotes } = data;
  const proj = (id: string | null) => projects.find((p) => p.id === id);
  // What waits for me: my approval step, or approved scrap I should dispose and record, or my returned requests
  const waiting = (d: ScrapDisposal) =>
    (d.status === 'pending_smp' && me.role === 'sm_projects') ||
    (d.status === 'pending_dgm' && me.role === 'gm') ||
    (['approved', 'returned', 'draft'].includes(d.status) && (d.requested_by === me.id || me.role === 'senior_elec_engineer'));
  const shown = rows.filter((d) =>
    group === 'open' ? SCRAP_OPEN.includes(d.status) : group === 'mine' ? waiting(d) : group === 'disposed' ? d.status === 'disposed' : true,
  );
  const disposed = rows.filter((d) => d.status === 'disposed');
  const year = new Date().getFullYear();
  const soldThisYear = disposed.filter((d) => d.method === 'sell' && (d.disposed_on ?? '').startsWith(String(year))).reduce((t, d) => t + Number(d.amount_received ?? 0), 0);
  const canRaise = SCRAP_RAISE.includes(me.role);

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Scrap disposal' }} />
      <TestingBanner what="Scrap disposal" always />
      <Muted>
        Scrap from a project&apos;s site store, the Project returns, or old material removed on site. Raised by the SEE or the project&apos;s Assistant Engineers, approved
        by SM Projects and then the DGM / GM, and disposed free of charge (with the reason) or sold (with quotations).
      </Muted>
      <Grid min={170}>
        <Stat label="Waiting for approval" value={String(rows.filter((d) => d.status === 'pending_smp' || d.status === 'pending_dgm').length)} tone="amber" />
        <Stat label="Approved – to dispose" value={String(rows.filter((d) => d.status === 'approved').length)} />
        <Stat label={`Disposed in ${year}`} value={String(disposed.filter((d) => (d.disposed_on ?? '').startsWith(String(year))).length)} tone="green" />
        <Stat label={`Received from sales in ${year}`} value={fmtMoney(soldThisYear, 'LKR')} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented
          value={group}
          onChange={setGroup}
          options={[
            { value: 'mine', label: 'Waiting for me', badge: rows.filter(waiting).length },
            { value: 'open', label: 'Open' },
            { value: 'disposed', label: 'Disposed' },
            { value: 'all', label: 'All' },
          ]}
        />
        {canRaise ? (
          <Button title="+ Scrap disposal" onPress={() => router.push({ pathname: '/execution/scrap/new', params: params.project ? { project: params.project } : {} })} />
        ) : null}
      </Row>
      {shown.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {shown.map((d) => {
            const st = SCRAP_STATUS[d.status];
            const p = proj(d.exec_project_id);
            const ls = lines.filter((l) => l.disposal_id === d.id);
            const qt = quotes.find((x) => x.id === d.selected_quote_id);
            return (
              <ListRow
                key={d.id}
                highlight={waiting(d) ? st.tone : undefined}
                title={`${d.code} · ${p ? `${p.code} ${p.name}` : d.location}`}
                subtitle={[
                  ls.slice(0, 3).map((l) => `${l.item} ${l.qty} ${l.unit}`).join(', ') + (ls.length > 3 ? ` +${ls.length - 3} more` : ''),
                  `${SCRAP_METHOD[d.method]}${d.method === 'sell' && qt ? ` – ${qt.buyer} ${fmtMoney(qt.amount_lkr, 'LKR')}` : d.foc_to ? ` – ${d.foc_to}` : ''}`,
                  `${people[d.requested_by]?.full_name ?? ''} · ${fmtDate(d.requested_at)}`,
                ].join('\n')}
                right={<Pill label={st.label} tone={st.tone} />}
                wrapRight
                onPress={() => router.push(`/execution/scrap/${d.id}`)}
              />
            );
          })}
        </Card>
      ) : (
        <Card>
          <Empty title={group === 'mine' ? 'Nothing waiting for you' : 'No scrap disposals'} hint={canRaise ? 'Raise one when material is damaged, left over as offcuts, or removed from site.' : undefined} />
        </Card>
      )}
    </Screen>
  );
}
