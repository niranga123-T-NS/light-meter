import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogProvider } from '@/components/dialog';
import { colors, Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';

function RootNavigator() {
  const { profile, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <Loading label="Signing you in…" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!profile}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!profile}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DialogProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </DialogProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
