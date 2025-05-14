/* global self */
/* -----------------------------------------------------------------------
   Token-counter worker (runs off the main thread)

   • Receives: { model, list:[{ck:number,text:string}] }
   • Replies : { total:number }  or  { total:0, error:string }
------------------------------------------------------------------------ */
import { encoding_for_model } from 'js-tiktoken/lite';
import cl100k_base            from 'js-tiktoken/ranks/cl100k_base.json';

/* encoder cache – one per model */
const encoders = new Map();
function getEncoder(model) {
  if (!encoders.has(model)) {
    encoders.set(model, encoding_for_model(model, cl100k_base));
  }
  return encoders.get(model);
}

/* 5 000-entry LRU cache of checksum → tokenCount */
const MAX = 5000;
const cache = new Map();
function setLru(key, val) {
  if (!cache.has(key) && cache.size >= MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, val);
}

self.onmessage = e => {
  try {
    const { model, list } = e.data;
    const enc = getEncoder(model);

    let total = 0;
    for (const { ck, text } of list) {
      let tok = cache.get(ck);
      if (tok == null) {
        tok = enc.encode(text).length;
        setLru(ck, tok);
      }
      total += tok;
    }
    self.postMessage({ total });
  } catch (err) {
    self.postMessage({ total: 0, error: err.message });
  }
};

/* surface *unexpected* worker exceptions */
self.addEventListener('error', e => {
  self.postMessage({ total: 0, error: e.message });
});
