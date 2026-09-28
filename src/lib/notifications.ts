// Local reminders for follow-up actions (works offline). Web: no-op.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { setting } from './cache';
import { supabase } from './supabase';
import type { Action } from './types';

let configured = false;

export async function initNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!configured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Follow-up reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    configured = true;
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/** Re-schedule a reminder at 08:30 Colombo time, N days before each open action's due date. */
export async function scheduleActionReminders(actions: Action[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((n) => n.identifier.startsWith('action-'))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const daysBefore = Number(setting('reminder_days_before', 1));
    const now = Date.now();
    for (const a of actions) {
      if (!a.due_date || a.status === 'done' || a.status === 'cancelled') continue;
      // 08:30 in Colombo = 03:00 UTC
      const at = Date.parse(`${a.due_date}T03:00:00Z`) - daysBefore * 86400000;
      const when = at > now ? at : Date.parse(`${a.due_date}T03:00:00Z`);
      if (when <= now) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `action-${a.id}`,
        content: {
          title: daysBefore > 0 && at > now ? 'Follow-up due soon' : 'Follow-up due today',
          body: a.description.slice(0, 180),
          data: { url: `/action/${a.id}` },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'reminders' },
      });
    }
  } catch (e) {
    console.warn('Could not schedule reminders', e);
  }
}

/** Register this device for server alerts (needs an EAS project id). */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('device_push_tokens').upsert({ token, user_id: userId, platform: Platform.OS, updated_at: new Date().toISOString() });
  } catch {
    // push is optional; local reminders still work
  }
}
