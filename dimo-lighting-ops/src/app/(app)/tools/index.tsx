import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Academy } from '@/components/tools/Academy';
import { Catalogs } from '@/components/tools/Catalogs';
import { FixtureLibrary } from '@/components/tools/FixtureLibrary';
import { LuxMeter } from '@/components/tools/LuxMeter';
import { QuickCalcList } from '@/components/tools/QuickCalcList';
import { References } from '@/components/tools/References';
import { Standards } from '@/components/tools/Standards';
import { Field, Notice, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ESTIMATION_TAB_ROLES, FIXTURE_ROLES } from '@/lib/roles';
import { TOOLS_ROLES } from '@/lib/standards';

type Tab = 'standards' | 'catalogs' | 'fixtures' | 'lux' | 'calc' | 'refs' | 'learn';

/** Sales Tools: Standards, Catalogs, the Fixture finder (not for the Estimation tab roles), Lux meter (measures in the Android app only), DLux lighting calculations, project References and the Lighting Academy (Dacademy) */
export default function SalesTools() {
  const me = useMe();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'standards');
  const [search, setSearch] = useState('');
  if (!TOOLS_ROLES.includes(me.role)) return <Screen><Notice>Sales Tools are for the sales, SM Projects, DGM, Design, estimation and execution teams.</Notice></Screen>;
  const android = Platform.OS === 'android';
  // the fixture library and finder: here for Sales, Design and the engineers – the DGM, SM Projects and Estimation have it in the Estimation tab
  const fixtures = FIXTURE_ROLES.includes(me.role) && !ESTIMATION_TAB_ROLES.includes(me.role);
  return (
    <Screen maxWidth={tab === 'fixtures' ? 1300 : 1100}>
      <Stack.Screen options={{ title: 'Sales Tools' }} />
      <Segmented
        wrap
        value={tab}
        onChange={setTab}
        options={[
          { value: 'standards', label: 'Standards' },
          { value: 'catalogs', label: 'Catalogs' },
          ...(fixtures ? [{ value: 'fixtures' as const, label: 'Fixture finder' }] : []),
          { value: 'lux', label: android ? 'Lux meter' : 'Lux meter (Android)' },
          { value: 'calc', label: 'DLux' },
          { value: 'refs', label: 'References' },
          { value: 'learn', label: 'Dacademy' },
        ]}
      />
      {tab === 'standards' ? (
        <>
          <Field label="Search" value={search} onChangeText={setSearch} placeholder="e.g. classroom, car park, football, escape route" />
          <Standards search={search} />
        </>
      ) : tab === 'calc' ? (
        <QuickCalcList />
      ) : tab === 'learn' ? (
        <Academy />
      ) : tab === 'refs' ? (
        <References />
      ) : tab === 'fixtures' && fixtures ? (
        <FixtureLibrary />
      ) : tab === 'catalogs' ? (
        <Catalogs />
      ) : (
        <LuxMeter />
      )}
    </Screen>
  );
}
