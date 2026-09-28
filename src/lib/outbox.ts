// Visits captured on the device. Drafts autosave here; "Submit" validates and
// queues them; the sync engine sends queued items to submit_visit.
import { kv } from './kv';
import { createStore, useStore } from './store';
import type { OutboxItem, SyncStatus, VisitPayload } from './types';

export interface OutboxState {
  items: Record<string, OutboxItem>;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncing: boolean;
  online: boolean;
  loaded: boolean;
}

const KEY = 'dimo:outbox:v1';
export const outboxStore = createStore<OutboxState>({
  items: {}, lastSyncAt: null, lastSyncError: null, syncing: false, online: true, loaded: false,
});

let writeChain: Promise<void> = Promise.resolve();
function persist() {
  const { items, lastSyncAt, lastSyncError } = outboxStore.get();
  writeChain = writeChain.then(() => kv.setItem(KEY, JSON.stringify({ items, lastSyncAt, lastSyncError }))).catch(() => undefined);
  return writeChain;
}

export async function loadOutbox(): Promise<void> {
  try {
    const raw = await kv.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    // purge synced items older than 30 days
    const cutoff = Date.now() - 30 * 86400000;
    const items: Record<string, OutboxItem> = {};
    for (const [id, it] of Object.entries((saved.items ?? {}) as Record<string, OutboxItem>)) {
      if (it.status === 'synced' && it.syncedAt && Date.parse(it.syncedAt) < cutoff) continue;
      items[id] = it;
    }
    outboxStore.set((s) => ({ ...s, items, lastSyncAt: saved.lastSyncAt ?? null, lastSyncError: saved.lastSyncError ?? null, loaded: true }));
  } catch {
    outboxStore.set((s) => ({ ...s, loaded: true }));
  }
}

export function getItem(id: string): OutboxItem | undefined {
  return outboxStore.get().items[id];
}

export function saveDraft(payload: VisitPayload): OutboxItem {
  const now = new Date().toISOString();
  const prev = getItem(payload.visit.id);
  const item: OutboxItem = {
    id: payload.visit.id,
    status: prev && prev.status !== 'synced' ? (prev.status === 'queued' ? 'queued' : prev.status) : 'draft',
    payload,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    attempts: prev?.attempts ?? 0,
    error: prev?.error ?? null,
    serverCode: prev?.serverCode ?? null,
  };
  outboxStore.set((s) => ({ ...s, items: { ...s.items, [item.id]: item } }));
  void persist();
  return item;
}

export function updateItem(id: string, patch: Partial<OutboxItem>): void {
  const prev = getItem(id);
  if (!prev) return;
  outboxStore.set((s) => ({ ...s, items: { ...s.items, [id]: { ...prev, ...patch, updatedAt: new Date().toISOString() } } }));
  void persist();
}

export function setStatus(id: string, status: SyncStatus, extra: Partial<OutboxItem> = {}): void {
  updateItem(id, { status, ...extra });
}

export function removeItem(id: string): void {
  outboxStore.set((s) => {
    const items = { ...s.items };
    delete items[id];
    return { ...s, items };
  });
  void persist();
}

export function setSyncState(patch: Partial<Pick<OutboxState, 'syncing' | 'lastSyncAt' | 'lastSyncError' | 'online'>>): void {
  outboxStore.set((s) => ({ ...s, ...patch }));
  if ('lastSyncAt' in patch || 'lastSyncError' in patch) void persist();
}

export function useOutbox<S>(selector: (s: OutboxState) => S): S {
  return useStore(outboxStore, selector);
}

export function sortedItems(items: Record<string, OutboxItem>): OutboxItem[] {
  return Object.values(items).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
