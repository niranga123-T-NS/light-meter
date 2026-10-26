import { Stack } from 'expo-router';
import { FixtureLibrary } from '@/components/tools/FixtureLibrary';
import { Notice, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { FIXTURE_ROLES } from '@/lib/fixtures';

/** Fixture finder: the products of every manufacturer catalogue – search, BOQ-line matching and competitor equivalents (Estimation, Sales, Design, SM Projects, DGM) */
export default function Fixtures() {
  const me = useMe();
  if (!FIXTURE_ROLES.includes(me.role)) return <Screen><Notice>The fixture finder is for Estimation, Sales, Design, Operations, the project engineers, SM Projects and the DGM.</Notice></Screen>;
  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Fixture finder' }} />
      <FixtureLibrary />
    </Screen>
  );
}
