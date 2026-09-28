// Sync engine: sends queued visits to the server, safely retryable.
// 1. Upload attachments (idempotent: same path, "already exists" = done)
// 2. Call submit_visit (idempotent: device-generated IDs)
// 3. Mark synced / needs attention, refresh the reference cache
import { cacheStore, refreshCache } from './cache';
import { readFileBytes } from './files';
import { scheduleActionReminders } from './notifications';
import { getItem, outboxStore, setStatus, setSyncState, sortedItems, updateItem } from './outbox';
import { errorMessage, supabase } from './supabase';
import type { OutboxItem, VisitPayload } from './types';

let running: Promise<SyncResult> | null = null;

export interface SyncResult { sent: number; failed: number; offline: boolean }

function isNetworkError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  return msg.includes('network') || msg.includes('failed to fetch') || msg.includes('fetch failed')
    || msg.includes('timeout') || msg.includes('load failed') || msg.includes('aborted');
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file';
}

async function uploadAttachments(item: OutboxItem, userId: string): Promise<VisitPayload> {
  const payload = item.payload;
  const attachments = [...payload.attachments];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    if (a.uploaded && a.storage_path) continue;
    const path = a.storage_path ?? `${userId}/visit/${payload.visit.id}/${a.id}/${safeName(a.filename)}`;
    const bytes = await readFileBytes(a.localUri);
    const res = await supabase.storage.from('attachments').upload(path, bytes, { contentType: a.mime_type, upsert: false });
    if (res.error && !/exists|duplicate|409/i.test(`${res.error.message} ${(res.error as { statusCode?: string }).statusCode ?? ''}`)) {
      throw res.error;
    }
    attachments[i] = { ...a, uploaded: true, storage_path: path, size_bytes: a.size_bytes ?? bytes.length };
    // remember progress so a retry does not upload again
    updateItem(item.id, { payload: { ...payload, attachments } });
  }
  return { ...payload, attachments };
}

function toServerPayload(p: VisitPayload) {
  return {
    ...p,
    submit: true,
    attachments: p.attachments.filter((a) => a.uploaded).map((a) => ({
      id: a.id, entity_type: 'visit', entity_id: p.visit.id, storage_path: a.storage_path,
      filename: a.filename, mime_type: a.mime_type, size_bytes: a.size_bytes, caption: a.caption,
    })),
  };
}

async function sendOne(item: OutboxItem, userId: string): Promise<void> {
  const payload = await uploadAttachments(item, userId);
  const { data, error } = await supabase.rpc('submit_visit', { p: toServerPayload(payload) });
  if (error) throw error;
  const result = data as { code: string; status: string };
  setStatus(item.id, 'synced', { serverCode: result.code, error: null, syncedAt: new Date().toISOString() });
}

/** Send every queued visit. Concurrent calls share one run. */
export function syncNow(userId: string, opts: { includeFailed?: boolean } = {}): Promise<SyncResult> {
  if (running) return running;
  running = (async () => {
    setSyncState({ syncing: true });
    let sent = 0;
    let failed = 0;
    let offline = false;
    try {
      const queue = sortedItems(outboxStore.get().items).reverse()
        .filter((i) => i.status === 'queued' || (opts.includeFailed && i.status === 'needs_attention'));
      for (const it of queue) {
        const current = getItem(it.id);
        if (!current) continue;
        try {
          await sendOne(current, userId);
          sent++;
        } catch (e) {
          if (isNetworkError(e)) {
            offline = true;
            updateItem(it.id, { attempts: current.attempts + 1, error: 'Waiting for connection' });
            break;
          }
          failed++;
          setStatus(it.id, 'needs_attention', { attempts: current.attempts + 1, error: errorMessage(e) });
        }
      }
      try {
        await refreshCache(userId);
        await scheduleActionReminders(cacheStore.get().myActions);
      } catch (e) {
        if (isNetworkError(e)) offline = true;
      }
      setSyncState({
        lastSyncError: offline ? 'Offline – will retry when connected' : failed ? `${failed} visit(s) need attention` : null,
        ...(offline ? {} : { lastSyncAt: new Date().toISOString() }),
        online: !offline,
      });
      return { sent, failed, offline };
    } finally {
      setSyncState({ syncing: false });
      running = null;
    }
  })();
  return running;
}
