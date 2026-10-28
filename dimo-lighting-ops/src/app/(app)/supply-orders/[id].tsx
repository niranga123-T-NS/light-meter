import { Stack, useLocalSearchParams } from 'expo-router';
import { SupplyOrderView } from '@/components/SupplyOrders';
import { Screen } from '@/components/ui';

/** One supply order (supply-only project): manufacturers, PIs and their status with Operations */
export default function SupplyOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Supply order' }} />
      <SupplyOrderView id={id} />
    </Screen>
  );
}
