import { SiteRequestsView } from '@/components/exec/SiteRequests';
import { OrdersTabs } from '@/components/OrdersTabs';

/** Foreign & local orders → Site requests: every material and service request from the execution sites */
export default function OrdersSiteRequests() {
  return <SiteRequestsView tabs={<OrdersTabs value="requests" />} />;
}
