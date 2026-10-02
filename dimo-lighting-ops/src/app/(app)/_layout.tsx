import { Stack } from 'expo-router';
import { View } from 'react-native';
import { BottomBar, CountsProvider, HeaderActions, Sidebar } from '@/components/AppShell';
import { UpdateBanner } from '@/components/UpdateBanner';
import { colors, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { usePushRegistration } from '@/lib/push';

export default function AppLayout() {
  const me = useMe();
  const wide = useWide();
  usePushRegistration(me.id);

  return (
    <CountsProvider>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: colors.bg }}>
        {wide ? <Sidebar /> : null}
        <View style={{ flex: 1 }}>
          <UpdateBanner />
          <Stack
            screenOptions={{
              headerRight: () => <HeaderActions />,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
              headerStyle: { backgroundColor: '#fff' },
              contentStyle: { backgroundColor: colors.bg },
              headerBackButtonDisplayMode: 'minimal',
            }}
          />
        </View>
        {wide ? null : <BottomBar />}
      </View>
    </CountsProvider>
  );
}
