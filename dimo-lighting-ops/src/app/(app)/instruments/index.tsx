import { Stack } from 'expo-router';
import { InstrumentsView } from '@/components/InstrumentsView';
import { TestingBanner } from '@/components/Testing';
import { Screen } from '@/components/ui';

/** Testing / site instruments for every member (not subcontractors): the list, requests and the queue. */
export default function InstrumentsScreen() {
  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'Instruments' }} />
      <TestingBanner what="Instruments" />
      <InstrumentsView />
    </Screen>
  );
}
