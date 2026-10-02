import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/** Build id baked in at build time (Vercel commit); "dev" when running locally. */
export const BUILD_ID = (process.env.EXPO_PUBLIC_BUILD_ID ?? 'dev').slice(0, 7);
export const BUILD_TIME = process.env.EXPO_PUBLIC_BUILD_TIME ?? '';

/**
 * Website only: checks every few minutes (and when the tab comes back into view) whether a newer version has been
 * deployed, and offers a one-tap reload – an open tab otherwise keeps running the version it loaded.
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || BUILD_ID === 'dev') return;
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
      <Pressable onPress={() => window.location.reload()} style={{ backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: colors.blue, fontWeight: '700' }}>Reload now</Text>
      </Pressable>
    </View>
  );
}
