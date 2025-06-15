// file: src/hooks/useSignedUrl.js
import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';

const urlCache = new Map();
const MAX_CACHE_SIZE = 100; // Keep the 100 most recently used URLs

// Helper to enforce LRU cache policy
function getFromCache(path) {
    const entry = urlCache.get(path);
    if (entry) {
        // Move to end to mark as recently used
        urlCache.delete(path);
        urlCache.set(path, entry);
    }
    return entry;
}

function setInCache(path, value) {
    if (urlCache.size >= MAX_CACHE_SIZE) {
        // Evict the least recently used item (the first one in the map's iteration)
        const oldestKey = urlCache.keys().next().value;
        urlCache.delete(oldestKey);
    }
    urlCache.set(path, value);
}

export function useSignedUrl(path) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    const cached = getFromCache(path);
    if (cached && cached.expires > Date.now()) {
      setUrl(cached.url);
      return;
    }

    let isCancelled = false;
    const fetchUrl = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: funcError } = await supabase.functions.invoke('get-signed-urls', {
          body: { paths: [path], expiresIn: 60 },
        });

        if (funcError) throw funcError;
        if (data.error) throw new Error(data.error);

        const signedUrl = data.urlMap?.[path];
        if (!signedUrl) throw new Error('Signed URL not returned for path.');

        if (!isCancelled) {
          setInCache(path, { url: signedUrl, expires: Date.now() + 55 * 1000 });
          setUrl(signedUrl);
        }
      } catch (err) {
        console.error(`Failed to get signed URL for path: ${path}`, err);
        if (!isCancelled) {
          setError(err);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchUrl();

    return () => {
      isCancelled = true;
    };
  }, [path]);

  return { url, isLoading, error };
}
