import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Body, Card, colors, Loading, Muted, Screen, Title } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

function RootStack() {
  const { ready, session, profile } = useSession();
  if (!ready) return <Loading label="Starting…" />;
  const signedIn = !!session;
  const active = signedIn && !!profile?.active;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !active}>
        <Stack.Screen name="pending" />
      </Stack.Protected>
      <Stack.Protected guard={active}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

function NotConfigured() {
  return (
    <Screen>
      <Title>DIMO Sales – setup needed</Title>
      <Card>
        <Body>The app is not connected to a database yet.</Body>
        <Muted>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example and docs/DEPLOYMENT.md), then restart the app.
        </Muted>
      </Card>
    </Screen>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {isConfigured ? (
        <SessionProvider>
          <RootStack />
        </SessionProvider>
      ) : (
        <NotConfigured />
      )}
    </SafeAreaProvider>
  );
}
