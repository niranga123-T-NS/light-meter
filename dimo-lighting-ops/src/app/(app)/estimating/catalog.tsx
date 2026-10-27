import { Stack } from 'expo-router';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { FixtureLibrary } from '@/components/tools/FixtureLibrary';
import { Screen } from '@/components/ui';

/** Estimation › Catalog: the fixture library and finder (search, BOQ-line matching, competitor equivalents, photo search) */
export default function EstimationCatalog() {
  const blocked = useEstimationTab();
  if (blocked) return blocked;
  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Estimation' }} />
      <EstimationTabs value="catalog" />
      <FixtureLibrary />
    </Screen>
  );
}
