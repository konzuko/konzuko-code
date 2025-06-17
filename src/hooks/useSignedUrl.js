// file: src/hooks/useSignedUrl.js
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.js';

/**
 * Fetches a single signed URL from the Supabase Edge Function.
 * This function is used as the queryFn for TanStack Query.
 * @param {string} path - The storage path of the file.
 * @returns {Promise<string|null>} A promise that resolves with the signed URL.
 */
const fetchSignedUrl = async (path) => {
  if (!path) {
    return null;
  }

  // The function expects an array of paths, so we send one.
  const { data, error: funcError } = await supabase.functions.invoke('get-signed-urls', {
    body: { paths: [path], expiresIn: 900 }, // 15 minute expiry
  });

  if (funcError) throw funcError;
  if (data.error) throw new Error(data.error);

  const signedUrl = data.urlMap?.[path];
  if (!signedUrl) {
    // This can happen if the path is valid but the function fails to sign it,
    // or if the RLS policy denies access.
    throw new Error(`A signed URL was not returned for the path: ${path}`);
  }

  return signedUrl;
};

/**
 * A hook to get a temporary, signed URL for a file in Supabase Storage.
 * This has been refactored to use TanStack Query for robust caching,
 * state management, and devtools integration.
 *
 * @param {string | null} path The full path to the file in the storage bucket.
 * @returns {{url: string|null, isLoading: boolean, error: Error|null}}
 */
export function useSignedUrl(path) {
  const {
    data: url,
    isLoading,
    isError,
    error,
  } = useQuery({
    // The query key is an array that uniquely identifies this data.
    // When `path` changes, TanStack Query will fetch new data.
    queryKey: ['signedUrl', path],

    // The function that will be called to fetch the data.
    queryFn: () => fetchSignedUrl(path),

    // --- Configuration Options ---
    // The query will only run if `path` is a truthy value.
    enabled: !!path,

    // How long the data is considered fresh (in milliseconds).
    // We'll cache the URL for 14 minutes, since it expires in 15.
    // This prevents re-fetching a URL that is still valid.
    staleTime: 1000 * 60 * 14,

    // How long inactive data remains in the cache.
    gcTime: 1000 * 60 * 20,

    // We don't need to refetch a URL just because the user focused the window.
    refetchOnWindowFocus: false,

    // Don't refetch when the component remounts if data is fresh.
    refetchOnMount: false,

    // Retry once on failure.
    retry: 1,
  });

  return {
    url: url || null,
    isLoading,
    error: isError ? error : null,
  };
}
