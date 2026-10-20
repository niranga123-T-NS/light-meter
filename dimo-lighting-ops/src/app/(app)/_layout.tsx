import { Stack } from 'expo-router';
import { View } from 'react-native';
import { BottomBar, CountsProvider, HeaderActions, Sidebar } from '@/components/AppShell';
import { HighLevelBanner } from '@/components/HighLevelBanner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { colors, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useImmersive } from '@/lib/immersive';
import { usePushRegistration } from '@/lib/push';

export default function AppLayout() {
  const me = useMe();
  const wide = useWide();
  const full = useImmersive();
  usePushRegistration(me.id);

  return (
    <CountsProvider>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: colors.bg }}>
        {wide && !full ? <Sidebar /> : null}
        <View style={{ flex: 1 }}>
          {full ? null : <UpdateBanner />}
          {full ? null : <HighLevelBanner />}
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
        {wide || full ? null : <BottomBar />}
      </View>
    </CountsProvider>
  );
}
