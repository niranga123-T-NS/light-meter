import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { colors } from '@/components/ui';

export default function AppLayout() {
  // Tapping a reminder / alert opens the related screen (e.g. a late design request)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (data: unknown) => {
      const url = (data as { url?: string } | undefined)?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
