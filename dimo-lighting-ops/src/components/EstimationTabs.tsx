import { router } from 'expo-router';
import { Notice, Screen } from '@/components/ui';
import { IconTabs } from '@/components/tools/EstUi';
import { useMe } from '@/lib/auth';
import { ESTIMATION_TAB_ROLES } from '@/lib/roles';

const HREF = { catalog: '/estimating/catalog', boq: '/estimating/boq', supply: '/estimating/supply' } as const;

/** The sub-tabs of the Estimation tab */
export function EstimationTabs({ value }: { value: keyof typeof HREF }) {
  return (
    <IconTabs
      value={value}
      onChange={(v) => router.replace(HREF[v])}
      options={[
        { value: 'catalog' as const, label: 'Catalog', icon: 'catalog' },
        { value: 'boq' as const, label: 'BOQ match', icon: 'boq' },
        { value: 'supply' as const, label: 'Supply orders', icon: 'supply' },
      ]}
    />
  );
}

/** The DGM, SM Projects and the estimation team only */
export function useEstimationTab() {
  const me = useMe();
  return ESTIMATION_TAB_ROLES.includes(me.role) ? null : <Screen><Notice>The Estimation tab is for the DGM, SM Projects and the estimation team. The fixture finder is under Tools.</Notice></Screen>;
}
