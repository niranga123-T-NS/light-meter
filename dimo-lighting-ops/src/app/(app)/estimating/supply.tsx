import { Stack } from 'expo-router';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { SupplyOrdersList } from '@/components/SupplyOrders';
import { Screen } from '@/components/ui';

/** Estimation › Supply orders: supply-only projects waiting for the manufacturers' PIs */
export default function EstimationSupply() {
  const blocked = useEstimationTab();
  if (blocked) return blocked;
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Estimation' }} />
      <EstimationTabs value="supply" />
      <SupplyOrdersList />
    </Screen>
  );
}
