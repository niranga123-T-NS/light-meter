import { Redirect } from 'expo-router';
import { SITE_ROLES } from '@/components/OrdersTabs';
import { useMe } from '@/lib/auth';

/** Foreign & local orders: opens on the site's requests (office) or the foreign orders sub-tab */
export default function Orders() {
  const me = useMe();
  return <Redirect href={SITE_ROLES.includes(me.role) ? '/orders/site-requests' : '/orders/foreign'} />;
}
