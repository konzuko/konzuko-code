// src/lib/idbPersister.js
import { get, set, del } from 'idb-keyval';

/**
 * Creates a persister for TanStack Query that uses idb-keyval.
 * @param {string} idbValidKey - The key to use in IndexedDB for storing the cache.
 * @returns {import('@tanstack/react-query-persist-client').Persister}
 */
export function createIDBPersister(idbValidKey = 'reactQueryCache') { // Changed default key for clarity
  return {
    persistClient: async (client) => {
      console.log('[IDBPersister] Persisting client to IndexedDB with key:', idbValidKey);
      await set(idbValidKey, client);
    },
    restoreClient: async () => {
      console.log('[IDBPersister] Attempting to restore client from IndexedDB with key:', idbValidKey);
      const client = await get(idbValidKey);
      if (client) {
        console.log('[IDBPersister] Client restored from IndexedDB.');
      } else {
        console.log('[IDBPersister] No client found in IndexedDB to restore.');
      }
      return client;
    },
    removeClient: async () => {
      console.log('[IDBPersister] Removing client from IndexedDB with key:', idbValidKey);
      await del(idbValidKey);
    },
  };
}
