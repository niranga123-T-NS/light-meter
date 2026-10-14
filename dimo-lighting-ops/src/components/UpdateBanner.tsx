import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

/** Build id baked in at build time (Vercel commit); "dev" when running locally. */
export const BUILD_ID = (process.env.EXPO_PUBLIC_BUILD_ID ?? 'dev').slice(0, 7);
export const BUILD_TIME = process.env.EXPO_PUBLIC_BUILD_TIME ?? '';

/** The phone app: the app version it was built as (over-the-air updates only reach the same version) */
export const APP_VERSION = Platform.OS === 'web' ? null : Updates.runtimeVersion;
/** The phone app: the version it runs (an over-the-air update, or the one built into the app) */
export const APP_UPDATE = Platform.OS === 'web' ? null : Updates.isEmbeddedLaunch ? 'built-in' : Updates.createdAt ? Updates.createdAt.toISOString().slice(0, 10) : null;

/**
 * Website: checks every few minutes (and when the tab comes back into view) whether a newer version has been
 * deployed, and offers a one-tap reload – an open tab otherwise keeps running the version it loaded.
 * Phone app: checks for an over-the-air update when the app opens and when it comes back to the front; a downloaded
 * update is offered with a one-tap restart (it is also used anyway the next time the app starts).
 */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web' || !Updates.isEnabled) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable && (await Updates.fetchUpdateAsync()).isNew) setNewer(true);
      } catch {
        // offline, or the update server is not reachable – try again next time
      } finally {
        busy = false;
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void check());
    return () => sub.remove();
  }, []);
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
      <Pressable onPress={() => (Platform.OS === 'web' ? window.location.reload() : void Updates.reloadAsync())} style={{ backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: colors.blue, fontWeight: '700' }}>{Platform.OS === 'web' ? 'Reload now' : 'Restart now'}</Text>
      </Pressable>
    </View>
  );
}
