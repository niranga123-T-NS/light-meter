import { CertsView } from '@/components/exec/CertsView';
import { OrdersTabs } from '@/components/OrdersTabs';

/** Foreign & local orders → Subcontractor invoices: the IPCs and invoices of the execution projects */
export default function OrdersSubcontractor() {
  return <CertsView tabs={<OrdersTabs value="sub" />} />;
}
