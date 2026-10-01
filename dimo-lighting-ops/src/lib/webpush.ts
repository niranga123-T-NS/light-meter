import { Platform } from 'react-native';
import { supabase } from './supabase';

// Web Push for the web portal and the home-screen web app (Chrome, Edge, Firefox, Safari; iPhone / iPad from
// iOS 16.4 once the portal is added to the Home Screen). The service worker (public/sw.js) shows the notices;
// the push-dispatch Edge Function sends them with the same wording and timing as the mobile app.

export type WebPushStatus = 'unsupported' | 'needs-home-screen' | 'blocked' | 'off' | 'on';

let active = false;
/** True once this browser holds a push subscription – in-page browser notices are then left to the service worker. */
export const webPushActive = () => active;

const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';

export function isIos() {
  if (!isWeb()) return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (!isWeb()) return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const supported = () => isWeb() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function webPushStatus(): Promise<WebPushStatus> {
  if (!isWeb()) return 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-home-screen';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  active = Boolean(sub) && Notification.permission === 'granted';
  return active ? 'on' : 'off';
}

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function vapidKey(): Promise<string> {
  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/push-dispatch?vapid=1`;
  const res = await fetch(url, { headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' } });
  const json = (await res.json().catch(() => ({}))) as { vapidPublicKey?: string | null };
  if (!json.vapidPublicKey) throw new Error('Notifications are not set up on the server yet');
  return json.vapidPublicKey;
}

async function save(userId: string, sub: PushSubscription) {
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ token: JSON.stringify(sub.toJSON()), user_id: userId, platform: 'web', updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  active = true;
}

/** Turns notifications on for this browser. Must run from a tap (iPhone requires it). */
export async function enableWebPush(userId: string) {
  if (!supported()) throw new Error('This browser does not support notifications');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed – enable them in the browser or phone settings');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await vapidKey()) }));
  await save(userId, sub);
}

export async function disableWebPush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_tokens').delete().eq('token', JSON.stringify(sub.toJSON()));
    await sub.unsubscribe();
  }
  active = false;
}

/** On every start: register the service worker and keep an existing subscription linked to the signed-in user. */
export async function refreshWebPush(userId: string) {
  if (!supported()) return;
  const reg = await registration();
  if (Notification.permission !== 'granted') return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await save(userId, sub);
}
