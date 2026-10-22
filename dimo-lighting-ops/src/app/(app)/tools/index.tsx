import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Academy } from '@/components/tools/Academy';
import { Catalogs } from '@/components/tools/Catalogs';
import { LuxMeter } from '@/components/tools/LuxMeter';
import { QuickCalcList } from '@/components/tools/QuickCalcList';
import { References } from '@/components/tools/References';
import { Standards } from '@/components/tools/Standards';
import { Field, Notice, Screen, Segmented } from '@/components/ui';
import { ACADEMY_ONLY } from '@/lib/academy';
import { useMe } from '@/lib/auth';
import { TOOLS_ROLES } from '@/lib/standards';

type Tab = 'standards' | 'catalogs' | 'lux' | 'calc' | 'refs' | 'learn';

/** Sales Tools: Standards, Catalogs, Lux meter (measures in the Android app only), DLux lighting calculations, project References and the Lighting Academy (Dacademy) */
export default function SalesTools() {
  const me = useMe();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'standards');
  const [search, setSearch] = useState('');
  // the engineers and Estimation have Dacademy only, not the rest of Sales Tools
  if (ACADEMY_ONLY.includes(me.role)) {
    return (
      <Screen maxWidth={1100}>
        <Stack.Screen options={{ title: 'Dacademy' }} />
        <Academy />
      </Screen>
    );
  }
  if (!TOOLS_ROLES.includes(me.role)) return <Screen><Notice>Sales Tools are for the sales, SM Projects, GM / DGM and Design teams.</Notice></Screen>;
  const android = Platform.OS === 'android';
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Sales Tools' }} />
      <Segmented
        wrap
        value={tab}
        onChange={setTab}
        options={[
          { value: 'standards', label: 'Standards' },
          { value: 'catalogs', label: 'Catalogs' },
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
      ) : tab === 'catalogs' ? (
        <Catalogs />
      ) : (
        <LuxMeter />
      )}
    </Screen>
  );
}
