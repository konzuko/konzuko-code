import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';

const urlCache = new Map();

export function useSignedUrl(path) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    // Check cache first
    const cached = urlCache.get(path);
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
          body: { paths: [path], expiresIn: 60 }, // 60 seconds for UI display
        });

        if (funcError) throw funcError;
        if (data.error) throw new Error(data.error);

        const signedUrl = data.urlMap?.[path];
        if (!signedUrl) throw new Error('Signed URL not returned for path.');

        if (!isCancelled) {
          // Cache the URL with an expiry time (55 seconds to be safe)
          urlCache.set(path, { url: signedUrl, expires: Date.now() + 55 * 1000 });
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
