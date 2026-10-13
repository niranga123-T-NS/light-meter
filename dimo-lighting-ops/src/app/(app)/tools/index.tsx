import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Catalogs } from '@/components/tools/Catalogs';
import { QuickCalcList } from '@/components/tools/QuickCalcList';
import { Standards } from '@/components/tools/Standards';
import { Card, Field, Muted, Notice, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { TOOLS_ROLES } from '@/lib/standards';

type Tab = 'standards' | 'catalogs' | 'lux' | 'calc';

/** Sales Tools: Standards, Catalogs, Lux meter (Android app only) and DLux lighting calculations */
export default function SalesTools() {
  const me = useMe();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'standards');
  const [search, setSearch] = useState('');
  if (!TOOLS_ROLES.includes(me.role)) return <Screen><Notice>Sales Tools are for the sales, SM Projects, GM / DGM and Design teams.</Notice></Screen>;
  const android = Platform.OS === 'android';
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Sales Tools' }} />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'standards', label: 'Standards' },
          { value: 'catalogs', label: 'Catalogs' },
          ...(android ? [{ value: 'lux' as Tab, label: 'Lux meter' }] : []),
          { value: 'calc', label: 'DLux' },
        ]}
      />
      {tab === 'standards' ? (
        <>
          <Field label="Search" value={search} onChangeText={setSearch} placeholder="e.g. classroom, car park, football, escape route" />
          <Standards search={search} />
        </>
      ) : tab === 'calc' ? (
        <QuickCalcList />
      ) : tab === 'catalogs' ? (
        <Catalogs />
      ) : (
        <Card style={{ gap: 6 }}>
          <Muted>
            {tab === 'lux'
                ? 'The lux meter – calibrated readings, room surveys and before / after – comes with the next Android app.'
                : ''}
          </Muted>
        </Card>
      )}
    </Screen>
  );
}
