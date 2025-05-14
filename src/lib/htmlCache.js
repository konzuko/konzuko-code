/**
 * In-memory LRU cache:  checksum32 → pre-rendered, sanitised HTML
 * Keeps at most MAX entries; eviction is O(1).
 */
import { mdToSafeHtml } from './mdRender.js';

const MAX   = 2000;
const cache = new Map();

/* Move key to MRU position, evict if we exceeded MAX */
function setLru(key, value) {
  if (!cache.has(key) && cache.size >= MAX) {
    cache.delete(cache.keys().next().value);   // remove LRU
  }
  cache.set(key, value);                       // inserts or refreshes
}

/** Returns cached HTML or renders + caches it. */
export function getHtml(checksum, plainText) {
  if (cache.has(checksum)) {
    const html = cache.get(checksum);
    // refresh position (MRU)
    cache.delete(checksum);
    cache.set(checksum, html);
    return html;
  }
  const html = mdToSafeHtml(plainText);
  setLru(checksum, html);
  return html;
}
