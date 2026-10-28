import { router } from 'expo-router';
import { Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';

/** Who sees the site's requests and the subcontractor invoices among the orders: Operations, SM Projects, DGM and the SEE */
export const SITE_ROLES = ['operations_exec', 'sm_projects', 'gm', 'senior_elec_engineer'];
const HREF = { requests: '/orders/site-requests', foreign: '/orders/foreign', local: '/orders/local', supply: '/orders/supply', sub: '/orders/subcontractor' } as const;

/** The sub-tabs of Foreign & local orders */
export function OrdersTabs({ value }: { value: 'requests' | 'foreign' | 'local' | 'supply' | 'sub' }) {
  const me = useMe();
  const site = SITE_ROLES.includes(me.role);
  return (
    <Segmented
      value={value}
      onChange={(v) => router.replace(HREF[v])}
      options={[
        ...(site ? [{ value: 'requests' as const, label: 'Site requests' }] : []),
        { value: 'foreign' as const, label: 'Foreign orders ✈' },
        { value: 'local' as const, label: 'Local orders' },
        { value: 'supply' as const, label: 'Supply orders' },
        ...(site ? [{ value: 'sub' as const, label: 'Subcontractor invoices' }] : []),
      ]}
    />
  );
}
