import type { DtIn, DtOut, DtState, DtSummary, EngineHandle } from '@/lib/designTools';

/** Asks the page for its current design and waits for the answer */
let seq = 1;
const waiting = new Map<number, (v: { state: DtState; summary: DtSummary }) => void>();
export function requestState(h: EngineHandle | null, timeoutMs = 8000) {
  return new Promise<{ state: DtState; summary: DtSummary }>((resolve, reject) => {
    if (!h) return reject(new Error('The design page is still opening'));
    const id = seq++;
    const t = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('The design page did not answer – reload it and try again'));
    }, timeoutMs);
    waiting.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    h.send({ type: 'dt:get', id } as DtIn);
  });
}
/** Every message from the page goes through here first */
export function routeMessage(m: DtOut) {
  if (m.type === 'dt:state') {
    const f = waiting.get(m.id);
    if (f) {
      waiting.delete(m.id);
      f({ state: m.state, summary: m.summary });
    }
  }
}
