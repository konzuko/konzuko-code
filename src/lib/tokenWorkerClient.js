/* ------------------------------------------------------------------
   tokenWorkerClient  – Promise-based RPC wrapper for the token worker
-------------------------------------------------------------------*/
import tokenWorker, { allocId } from './tokenWorkerSingleton.js';

const pending = new Map();      // id → { resolve, reject }

/* Global reply handler – routes by id */
tokenWorker.addEventListener('message', e => {
  const { id, total, error } = e.data;
  const p = pending.get(id);
  if (!p) return;               // unknown / timed-out
  pending.delete(id);
  if (error) p.reject(new Error(error));
  else       p.resolve(total);
});

/* countTokens(model, list) → Promise<number> */
export function countTokens(model, list) {
  const id = allocId();
  tokenWorker.postMessage({ id, model, list });

  return new Promise((resolve, reject) => {
    /* 60-second safety timeout */
    const t = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('tokenWorker timeout'));
      }
    }, 60_000);

    /* store wrapped resolvers that clear timeout */
    pending.set(id, {
      resolve: val => { clearTimeout(t); resolve(val); },
      reject : err => { clearTimeout(t); reject(err); }
    });
  });
}
