import { router, Stack } from 'expo-router';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { SupplyOrdersList } from '@/components/SupplyOrders';
import { Text } from 'react-native';
import { colors, Screen } from '@/components/ui';
import { EstIcon, Tip } from '@/components/tools/EstUi';
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
      <SupplyOrdersList
        extra={me.role === 'sm_estimation' || me.role === 'gm' ? (
          <Tip title="Earlier award to order" text="A project or inquiry awarded before the system: straight to the supply order or the hand-over to execution." onPress={() => router.push('/estimating/earlier-award')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.ink }}>
            <EstIcon name="award" size={16} />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Earlier award to order</Text>
          </Tip>
        ) : null}
      />
    </Screen>
  );
}
