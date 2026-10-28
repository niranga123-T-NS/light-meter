import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Pill, Row, Segmented } from '@/components/ui';
import type { SecuredProject } from '@/lib/finance';
import { rpc } from '@/lib/supabase';

type Kind = 'supply' | 'supply_install';
export const PROJECT_TYPE_LABEL: Record<Kind, string> = { supply: 'Supply only', supply_install: 'Supply & installation' };

/** Order book: the project type chosen with the invoice plan – Supply only goes to SM Estimation for the PIs, Supply & installation to execution */
export function ProjectTypeRow({ s, canSet, supplyOrder, onChange }: { s: SecuredProject; canSet: boolean; supplyOrder: { id: string; code: string } | null; onChange: () => void }) {
  const dialog = useDialog();
  const t = s.project_type ?? null;
  const fixed = !!supplyOrder;
  const set = (v: Kind) => {
    if (v === t) return;
    dialog.run(async () => {
      await rpc('set_project_type', { p_secured: s.id, p_type: v });
      onChange();
    }, `Project type: ${PROJECT_TYPE_LABEL[v]}`);
  };
  return (
    <View style={{ gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Project type</Text>
        {canSet && !fixed ? (
          <Segmented<Kind>
            value={(t ?? '') as Kind}
            onChange={set}
            options={[
              { value: 'supply', label: PROJECT_TYPE_LABEL.supply },
              { value: 'supply_install', label: PROJECT_TYPE_LABEL.supply_install },
            ]}
          />
        ) : t ? (
          <Pill label={PROJECT_TYPE_LABEL[t]} tone={t === 'supply' ? colors.blue : colors.green} />
        ) : (
          <Pill label="Not chosen" tone={colors.amber} />
        )}
        {!t && s.schedule_status !== 'approved' ? <Text style={{ fontSize: 12, color: colors.amber, fontWeight: '700' }}>Choose it before sending the invoice plan</Text> : null}
        {supplyOrder ? <Button small variant="secondary" title={`Supply order ${supplyOrder.code} ›`} onPress={() => router.push(`/supply-orders/${supplyOrder.id}`)} /> : null}
      </Row>
      <Muted style={{ fontSize: 12 }}>
        {t === 'supply'
          ? 'Supply only: once the invoice plan is approved it goes to SM Estimation for the manufacturers’ PIs, then to Operations.'
          : t === 'supply_install'
            ? 'Supply & installation: once the invoice plan is approved Operations raises the hand-over to execution.'
            : 'Supply only goes to SM Estimation for the PIs; Supply & installation goes to execution. A project with any installation is Supply & installation.'}
      </Muted>
    </View>
  );
}
