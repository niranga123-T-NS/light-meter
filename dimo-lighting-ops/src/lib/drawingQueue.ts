import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useState } from 'react';
import type { DItem, DRoute } from './drawings';
import { rpc } from './supabase';

// Smart drawings on site without signal: stage, check, reading and metres-laid updates are kept on the device and sent in
// order when the connection is back. The last copy of each drawing opened is kept too, so it still opens in a basement.

const KEY = 'dimo.drawingQueue.v1';
const CACHE = 'dimo.drawingCache.v1.';

export type QueuedCall = { n: number; drawing: string; fn: 'drawing_item_status' | 'drawing_items_status' | 'drawing_item_checks' | 'drawing_route_progress'; args: Record<string, unknown>; at: string; error?: string };

async function readQueue(): Promise<QueuedCall[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedCall[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(q: QueuedCall[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
}

export function isNetworkError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return /network|fetch|timeout|offline|Load failed|Connection problem/i.test(m);
}

/** Sends the update, or keeps it on the device when there is no connection. Server refusals are thrown as usual. */
export async function callOrQueue<T = unknown>(drawing: string, fn: QueuedCall['fn'], args: Record<string, unknown>): Promise<{ queued: false; result: T } | { queued: true }> {
  const q = await readQueue();
  // keep the order: once something is waiting, later updates wait behind it
  if (!q.length) {
    try {
      return { queued: false, result: await rpc<T>(fn, args) };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await writeQueue([...q, { n: (q[q.length - 1]?.n ?? 0) + 1, drawing, fn, args, at: new Date().toISOString() }]);
  return { queued: true };
}

/** Sends what is waiting, oldest first. Stops at the first network error; an update the server refuses is dropped and reported. */
export async function syncDrawingQueue(): Promise<{ sent: number; refused: QueuedCall[]; left: number }> {
  const q = await readQueue();
  let sent = 0;
  const refused: QueuedCall[] = [];
  let i = 0;
  for (; i < q.length; i++) {
    try {
      await rpc(q[i].fn, q[i].args);
      sent += 1;
    } catch (e) {
      if (isNetworkError(e)) break;
      refused.push({ ...q[i], error: e instanceof Error ? e.message : String(e) });
    }
  }
  await writeQueue(q.slice(i));
  return { sent, refused, left: q.length - i };
}

/** The drawing as the site will see it once the waiting updates are sent. */
export function applyQueued<T extends { items: DItem[]; routes: DRoute[] }>(data: T, q: QueuedCall[]): T {
  if (!q.length) return data;
  const items = data.items.map((x) => ({ ...x }));
  const routes = data.routes.map((x) => ({ ...x }));
  for (const c of q) {
    const a = c.args as Record<string, never>;
    if (c.fn === 'drawing_item_status') {
      const it = items.find((x) => x.id === a.p_id);
      if (it) it.status = a.p_status;
    } else if (c.fn === 'drawing_items_status') {
      const ids = a.p_ids as unknown as string[];
      for (const it of items)
        if (ids.includes(it.id) && (!['tested', 'done'].includes(a.p_status) || Object.values(it.checks ?? {}).every(Boolean))) it.status = a.p_status;
    } else if (c.fn === 'drawing_item_checks') {
      const it = items.find((x) => x.id === a.p_id);
      if (it && a.p_checks) it.checks = a.p_checks;
      if (it && a.p_readings) it.readings = a.p_readings;
    } else {
      const r = routes.find((x) => x.id === a.p_id);
      if (r) {
        r.status = a.p_status ?? r.status;
        if (a.p_laid != null) r.laid = a.p_laid;
      }
    }
  }
  return { ...data, items, routes };
}

export async function cacheDrawing(id: string, data: unknown) {
  try {
    await AsyncStorage.setItem(CACHE + id, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch {
    // the device is full – the drawing just won't open offline
  }
}

export async function cachedDrawing<T>(id: string): Promise<{ at: string; data: T } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE + id);
    return raw ? (JSON.parse(raw) as { at: string; data: T }) : null;
  } catch {
    return null;
  }
}

/** The waiting updates; sends them whenever the device is back online. */
export function useDrawingQueue(onSent?: (r: { sent: number; refused: QueuedCall[] }) => void) {
  const net = useNetworkState();
  const [queue, setQueue] = useState<QueuedCall[]>([]);
  const refresh = useCallback(async () => setQueue(await readQueue()), []);
  const sync = useCallback(async () => {
    const r = await syncDrawingQueue();
    await refresh();
    if (r.sent || r.refused.length) onSent?.(r);
    return r;
  }, [refresh, onSent]);
  useEffect(() => {
    readQueue().then(setQueue);
  }, []);
  // send whatever is waiting as soon as the phone is back online
  useEffect(() => {
    if (!net.isInternetReachable) return;
    syncDrawingQueue()
      .then(async (r) => {
        setQueue(await readQueue());
        if (r.sent || r.refused.length) onSent?.(r);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.isInternetReachable]);
  return { online: net.isInternetReachable !== false, queue, refresh, sync };
}
