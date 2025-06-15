// file: supabase/functions/_shared/ratelimit.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// This utility requires Deno KV to be enabled for your Supabase project.
// You can enable it in your project's dashboard under Database -> KV.
const kv = await Deno.openKv();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30;     // Max 30 requests per user per minute per endpoint

/**
 * Checks if a user has exceeded the rate limit for a specific endpoint.
 * Uses Deno KV to track request timestamps.
 *
 * @param userId The ID of the user to check.
 * @param endpoint A unique name for the endpoint being rate-limited (e.g., 'manage-api-key').
 * @returns {Promise<boolean>} True if the user is rate-limited, false otherwise.
 */
export async function isRateLimited(userId: string, endpoint: string): Promise<boolean> {
  const key = ['ratelimit', endpoint, userId];
  const now = Date.now();
  
  try {
    const entry = await kv.get<number[]>(key);
    const timestamps: number[] = entry.value || [];

    // Clear out timestamps that are older than the defined window
    const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      return true; // User is rate-limited
    }

    // Add the current request's timestamp and update the record in the KV store
    recentTimestamps.push(now);
    await kv.set(key, recentTimestamps, { expireIn: RATE_LIMIT_WINDOW_MS });

    return false; // User is not rate-limited
  } catch (error) {
    console.error(`Deno KV error in rate limiter for user ${userId} at endpoint ${endpoint}:`, error);
    // Fail open (do not rate limit) if KV store is unavailable
    return false;
  }
}
