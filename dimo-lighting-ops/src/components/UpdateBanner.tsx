import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/** Build id baked in at build time (Vercel commit); "dev" when running locally. */
export const BUILD_ID = (process.env.EXPO_PUBLIC_BUILD_ID ?? 'dev').slice(0, 7);
export const BUILD_TIME = process.env.EXPO_PUBLIC_BUILD_TIME ?? '';

/**
 * Checks whether a newer version has been deployed and offers a one-tap reload.
 *  Website: every few minutes and when the tab comes back into view (an open tab keeps the version it loaded).
 *  Phone app: on start and when the app comes back to the front, downloads the latest over-the-air update (EAS Update).
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Updates = require('expo-updates') as typeof import('expo-updates');
      if (!Updates.isEnabled) return;
      const fetchNewer = () =>
        Updates.checkForUpdateAsync()
          .then((c) => (c.isAvailable ? Updates.fetchUpdateAsync() : null))
          .then((f) => f?.isNew && setNewer(true))
          .catch(() => undefined);
      void fetchNewer();
      const sub = AppState.addEventListener('change', (st) => st === 'active' && void fetchNewer());
      return () => sub.remove();
    }
    if (BUILD_ID === 'dev') return;
    const check = () =>
      fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((v: { id?: string } | null) => {
          if (v?.id && v.id.slice(0, 7) !== BUILD_ID) setNewer(true);
        })
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 5 * 60 * 1000);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  if (!newer) return null;
  return (
    <View style={{ backgroundColor: colors.blue, paddingVertical: 8, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: '#fff', flex: 1, fontWeight: '600' }}>A new version of DIMO Lighting Ops is available.</Text>
      <Pressable
        onPress={() => {
          if (Platform.OS === 'web') window.location.reload();
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          else void (require('expo-updates') as typeof import('expo-updates')).reloadAsync();
        }} style={{ backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: colors.blue, fontWeight: '700' }}>Reload now</Text>
      </Pressable>
    </View>
  );
}
