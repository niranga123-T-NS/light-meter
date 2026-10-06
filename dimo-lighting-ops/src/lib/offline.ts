import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Offline visit entry (Section 4.3): a visit saved without signal is queued on the device
// and synced later. The app generates the visit id, so a retried sync never duplicates it;
// check-in time is the device time at capture.

const KEY = 'dimo.offlineVisits.v1';

export type QueuedVisit = { id: string; payload: Record<string, unknown>; queuedAt: string; lastError?: string };

async function readQueue(): Promise<QueuedVisit[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as QueuedVisit[]) : [];
}

async function writeQueue(q: QueuedVisit[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
}

function isNetworkError(message: string) {
  return /network|fetch|timeout|offline|Failed to fetch/i.test(message);
}

/**
 * Saves a visit online, or queues it when there is no connection.
 * Returns 'saved' or 'queued'. Validation errors from the server are thrown.
 */
export async function saveVisit(payload: Record<string, unknown> & { id: string }): Promise<'saved' | 'queued'> {
  try {
    const { error } = await supabase.from('visits').upsert(payload, { onConflict: 'id' });
    if (!error) return 'saved';
    if (!isNetworkError(error.message)) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!isNetworkError(msg)) throw e;
  }
  const q = await readQueue();
  await writeQueue([...q.filter((v) => v.id !== payload.id), { id: payload.id, payload, queuedAt: new Date().toISOString() }]);
  return 'queued';
}

export async function syncQueuedVisits(): Promise<{ synced: number; failed: number }> {
  const q = await readQueue();
  let synced = 0;
  const remaining: QueuedVisit[] = [];
  for (const item of q) {
    const { error } = await supabase.from('visits').upsert(item.payload, { onConflict: 'id' });
    if (error) remaining.push({ ...item, lastError: error.message });
    else synced += 1;
  }
  await writeQueue(remaining);
  return { synced, failed: remaining.length };
}

export async function queuedVisits() {
  return readQueue();
}

/** Syncs whenever the device comes back online; exposes the pending count. */
export function useOfflineSync() {
  const net = useNetworkState();
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<{ synced: number; failed: number } | null>(null);

  const refresh = useCallback(async () => setPending((await readQueue()).length), []);

  const sync = useCallback(async () => {
    const res = await syncQueuedVisits();
    setLastSync(res);
    await refresh();
    return res;
  }, [refresh]);

  useEffect(() => {
    readQueue().then((q) => setPending(q.length));
  }, []);

  // Sync whenever the device comes back online
  useEffect(() => {
    if (!net.isInternetReachable) return;
    syncQueuedVisits()
      .then((res) => {
        setLastSync(res);
        return readQueue();
      })
      .then((q) => setPending(q.length))
      .catch(() => undefined);
  }, [net.isInternetReachable]);

  return { online: net.isInternetReachable !== false, pending, lastSync, sync, refresh };
}

/** Access ended (removed supervisor, deleted temporary role): wipe everything this app cached on the device */
export async function clearDeviceData() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('dimo.')));
  } catch {
    // nothing cached
  }
}
