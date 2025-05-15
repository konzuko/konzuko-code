
  import { encoding_for_model } from 'js-tiktoken/lite';
  
  /*
    IMPORTANT
    ---------
    We now load the rank-map from a LOCAL JavaScript file so Vite can bundle
    it without hitting the package “exports” restriction that broke the
    previous JSON import.
       • cl100k_base.js must `export default [...]`
  */
  import cl100k_base from './cl100k_base.js';
  
  /* ────────── encoder cache (per model) ────────── */
  const encoders = new Map();
  function getEncoder(model) {
    if (!encoders.has(model)) {
      encoders.set(model, encoding_for_model(model, cl100k_base));
    }
    return encoders.get(model);
  }
  
  /* ────────── checksum-to-tokens LRU  (5 000 entries) ────────── */
  const MAX   = 5000;
  const cache = new Map();
  function setLru(key, val) {
    if (!cache.has(key) && cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(key, val);
  }
  
  /* ────────── main message handler ────────── */
  self.onmessage = e => {
    const { id = 0, model, list } = e.data;
    try {
      const enc   = getEncoder(model);
      let   total = 0;
  
      for (const { ck, text } of list) {
        let tok = cache.get(ck);
        if (tok == null) {
          tok = enc.encode(text).length;
          setLru(ck, tok);
        }
        total += tok;
      }
      self.postMessage({ id, total });
    } catch (err) {
      self.postMessage({ id, total: 0, error: err.message });
    }
  };
  
  /* ────────── surface *unexpected* worker errors ────────── */
  self.addEventListener('error', e => {
    self.postMessage({ id: -1, total: 0, error: e.message });
  });
  