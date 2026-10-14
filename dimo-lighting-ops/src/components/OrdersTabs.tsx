import { router } from 'expo-router';
import { Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';

/** Who sees subcontractor invoices among the orders: Operations, SM Projects, GM / DGM and the SEE */
const SUB_ROLES = ['operations_exec', 'sm_projects', 'gm', 'senior_elec_engineer'];
const HREF = { foreign: '/orders/foreign', local: '/orders/local', sub: '/orders/subcontractor' } as const;

/** The sub-tabs of Foreign & local orders */
export function OrdersTabs({ value }: { value: 'foreign' | 'local' | 'sub' }) {
  const me = useMe();
  return (
    <Segmented
      value={value}
      onChange={(v) => router.replace(HREF[v])}
      options={[
        { value: 'foreign' as const, label: 'Foreign orders ✈' },
        { value: 'local' as const, label: 'Local orders' },
        ...(SUB_ROLES.includes(me.role) ? [{ value: 'sub' as const, label: 'Subcontractor invoices' }] : []),
      ]}
    />
  );
}
