import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, colors, Empty, ListRow, Muted, Pill, Row, Section } from '@/components/ui';
import { VAR_NEXT, type ExecProject, type ProjVariation, type VarStage } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

const stageTone = (v: ProjVariation) =>
  v.days_late > 0 ? colors.red : v.stage === 'to_submit' ? colors.amber : v.stage === 'with_client' ? colors.blue : colors.grey;

/** The steps of a variation, ticked as they are done – DIMO's part first, then the client / consultant */
function steps(v: ProjVariation) {
  const order: VarStage[] = ['screening', 'design', 'estimation', 'dimo_approval', 'to_submit', 'with_client'];
  const at = order.indexOf(v.stage);
  const show = order.filter((s) => (s === 'design' ? v.route === 'A' : s === 'estimation' ? v.route !== 'C' : true));
  const label: Record<VarStage, string> = {
    screening: 'Screened',
    design: 'Design',
    estimation: 'Estimation',
    dimo_approval: 'DIMO approval',
    to_submit: 'Submitted',
    with_client: 'Client / consultant',
    closed: '',
  };
  return show.map((s) => `${order.indexOf(s) < at ? '✓' : order.indexOf(s) === at ? '▸' : '○'} ${label[s]}`).join('   ');
}

const money = (x?: number | null) => (x == null ? '' : `${x > 0 ? '+' : '−'}${fmtMoney(Math.abs(x), 'LKR')}`);

/**
 * Variations under the Bill tab: pending ones (with Design / Estimation in DIMO, DIMO approval, to submit, with the client /
 * consultant) against their agreed date – they are not in the BOQ until the SEE records the client's approval – and the
 * approved ones (in the BOQ as separate sections).
 */
export function VariationPipeline({ p, see }: { p: ExecProject; see: boolean }) {
  const { data } = useLoad(() => rpc<ProjVariation[]>('project_variations', { p_exec: p.id }), [p.id]);
  const all = data ?? [];
  const pending = all.filter((v) => v.stage !== 'closed').sort((a, b) => b.days_late - a.days_late || (a.due ?? '9').localeCompare(b.due ?? '9'));
  const approved = all.filter((v) => v.status === 'client_accepted');
  const late = pending.filter((v) => v.days_late > 0).length;
  return (
    <View style={{ gap: 8 }}>
      <Section
        title={`Pending variations (${pending.length})${late ? ` · ${late} late` : ''}`}
        right={see ? <Button small title="+ Approved variation" onPress={() => router.push(`/execution/variation/accept?project=${p.id}`)} /> : null}
      >
        <Muted>Not in the BOQ until the client / consultant approves them. Past the agreed date, SM Projects and DGM / GM are told.</Muted>
        {pending.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pending.map((v) => (
              <ListRow
                key={v.id}
                wrapRight
                highlight={stageTone(v)}
                onPress={() => router.push(`/execution/variation/${v.id}`)}
                title={`${v.code} · ${v.title}${v.value_lkr != null ? ` · ${money(v.value_lkr)}` : ''}`}
                subtitle={[
                  steps(v),
                  `Next: ${VAR_NEXT[v.stage]}`,
                  v.client_submitted_on ? `submitted ${fmtDate(v.client_submitted_on)}${v.client_submit_ref ? ` (${v.client_submit_ref})` : ''}` : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
                right={
                  <Row gap={6} wrap>
                    <Pill label={v.stage_label} tone={stageTone(v)} solid={v.days_late > 0} />
                    {v.due ? <Pill label={v.days_late > 0 ? `${v.days_late} d late · agreed ${fmtDate(v.due)}` : `agreed ${fmtDate(v.due)}`} tone={v.days_late > 0 ? colors.red : colors.grey} /> : null}
                  </Row>
                }
              />
            ))}
          </Card>
        ) : (
          <Empty title="No pending variations" />
        )}
      </Section>
      <Section title={`Approved by the client – in the BOQ (${approved.length})`}>
        {approved.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {approved.map((v) => (
              <ListRow
                key={v.id}
                highlight={colors.green}
                onPress={() => router.push(`/execution/variation/${v.id}`)}
                title={`VO ${v.vo_no ?? ''} · ${v.title}`}
                subtitle={`${v.code} · approved ${fmtDate(v.client_at)}${v.direct ? ' · added by the SEE' : ''}`}
                right={v.client_value_lkr != null || v.value_lkr != null ? <Pill label={money(v.client_value_lkr ?? v.value_lkr)} tone={colors.green} /> : undefined}
              />
            ))}
          </Card>
        ) : (
          <Muted>None yet.</Muted>
        )}
      </Section>
    </View>
  );
}
