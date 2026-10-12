import { Stack } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Standards } from '@/components/tools/Standards';
import { Card, Field, Muted, Notice, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { TOOLS_ROLES } from '@/lib/standards';

type Tab = 'standards' | 'catalogs' | 'lux' | 'calc';

/** Sales Tools: Standards, Catalogs, Lux meter (Android app only) and Quick calculations */
export default function SalesTools() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('standards');
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
          { value: 'calc', label: 'Quick calc' },
        ]}
      />
      {tab === 'standards' ? (
        <>
          <Field label="Search" value={search} onChangeText={setSearch} placeholder="e.g. classroom, car park, football, escape route" />
          <Standards search={search} />
        </>
      ) : (
        <Card style={{ gap: 6 }}>
          <Muted>
            {tab === 'catalogs'
              ? 'Catalogs – DIMO products with data sheets and IES files, stock, sharing with the DIMO watermark and competitor comparison – come in the next release.'
              : tab === 'lux'
                ? 'The lux meter – calibrated readings, room surveys and before / after – comes with the next Android app.'
                : 'Quick calculations – room, product, result and savings with a shareable sheet – come in a following release.'}
          </Muted>
        </Card>
      )}
    </Screen>
  );
}
