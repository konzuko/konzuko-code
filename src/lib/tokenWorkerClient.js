// file: src/lib/tokenWorkerClient.js
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

/**
 * Initializes the token worker with the user's API key.
 * This should be called once when the key is available.
 * @param {string} apiKey
 */
export function initTokenWorker(apiKey) {
  tokenWorker.postMessage({ type: 'INIT', apiKey });
}

/**
 * Asks the worker to count tokens for the given content.
 * @param {string} model - The model name to use for counting.
 * @param {Array<{type: 'text', value: string} | {type: 'pdf', uri: string, mimeType: string}>} items - The content to count.
 * @returns {Promise<number>} A promise that resolves with the total token count.
 */
export function countTokensWithGemini(model, items) {
  const id = allocId();
  // API key is no longer passed with each message
  tokenWorker.postMessage({ type: 'COUNT', id, model, items });

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
