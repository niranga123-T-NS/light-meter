import { Stack } from 'expo-router';
import { OrdersTabs } from '@/components/OrdersTabs';
import { SupplyOrdersList } from '@/components/SupplyOrders';
import { Screen } from '@/components/ui';

/** Foreign & local orders › Supply orders: the PIs SM Estimation submits for supply-only projects, with their status */
export default function OrdersSupply() {
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Foreign & local orders' }} />
      <OrdersTabs value="supply" />
      <SupplyOrdersList />
    </Screen>
  );
}
