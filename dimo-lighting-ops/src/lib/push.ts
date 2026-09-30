import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Push notifications (Section 8.4): the mobile app registers its Expo push token; the
// push-dispatch Edge Function sends queued notifications through Expo (FCM / APNs).
// The web portal shows in-app notices and browser notifications while the portal is open.

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

async function registerNativeToken(userId: string) {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Work notifications',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('critical', {
      name: 'Critical alerts',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!status.granted) return;
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('No EAS projectId – run `eas init` so push notifications can be delivered.');
    return;
  }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await supabase
    .from('push_tokens')
    .upsert({ token, user_id: userId, platform: Platform.OS, updated_at: new Date().toISOString() });
}

/** Registers for push and routes notification taps to the record (e.g. /inquiries/<id>). */
export function usePushRegistration(userId: string | undefined) {
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    registerNativeToken(userId).catch((e) => console.warn('Push registration failed', e));
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
    });
    return () => sub.remove();
  }, [userId]);
}

/** Browser notification while the web portal is open (in addition to the in-app list). */
export function showBrowserNotification(title: string, body: string, url?: string | null) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('Notification' in window)) return;
  const show = () => {
    const n = new Notification(title, { body, tag: url ?? undefined });
    n.onclick = () => {
      window.focus();
      if (url) router.push(url as never);
    };
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show());
}
