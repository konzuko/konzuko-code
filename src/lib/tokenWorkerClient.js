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
  else       p.resolve(total); // The worker now directly sends the total number
});

/* countTokensWithGemini(apiKey, model, items) → Promise<number> */
// items: Array<{type: 'text', value: string} | {type: 'pdf', uri: string, mimeType: string}>
export function countTokensWithGemini(apiKey, model, items) {
  const id = allocId();
  tokenWorker.postMessage({ id, apiKey, model, items }); // Pass new parameters

  return new Promise((resolve, reject) => {
    /* 60-second safety timeout */
    const t = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Gemini tokenWorker timeout'));
      }
    }, 60_000);

    /* store wrapped resolvers that clear timeout */
    pending.set(id, {
      resolve: val => { clearTimeout(t); resolve(val); },
      reject : err => { clearTimeout(t); reject(err); }
    });
  });
}
