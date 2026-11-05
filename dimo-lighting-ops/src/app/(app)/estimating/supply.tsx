import { router, Stack } from 'expo-router';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { SupplyOrdersList } from '@/components/SupplyOrders';
import { Button, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';

/** Estimation › Supply orders: supply-only projects waiting for the manufacturers' PIs */
export default function EstimationSupply() {
  const blocked = useEstimationTab();
  const me = useMe();
  if (blocked) return blocked;
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Estimation' }} />
      <EstimationTabs value="supply" />
      {me.role === 'sm_estimation' || me.role === 'gm' ? (
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button small title="Send an earlier award to order" onPress={() => router.push('/estimating/earlier-award')} />
        </Row>
      ) : null}
      <SupplyOrdersList />
    </Screen>
  );
}
