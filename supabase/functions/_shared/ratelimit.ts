// file: supabase/functions/_shared/ratelimit.ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- Client Initialization ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_K, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// --- Defaults ---
const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_CALLS = 30;     // 30 calls per window

export async function isRateLimited(
  userId: string,
  endpoint: string,
  windowMs = DEFAULT_WINDOW_MS,
  maxCalls = DEFAULT_MAX_CALLS
): Promise<boolean> {
  try {
    // 1. Record this call
    const { error: insertErr } = await admin
      .from('rate_limit_events')
      .insert({ user_id: userId, endpoint });

    if (insertErr) {
      console.error('[ratelimit] INSERT failed – falling open:', insertErr.message);
      return false;
    }

    // 2. Count calls still inside the window
    const windowStartISO = new Date(Date.now() - windowMs).toISOString();

    // STAGE 2 NOTE: For extremely high traffic, you could trade perfect accuracy for
    // performance by using an approximate count: { count: 'estimated' }
    const { count, error: cntErr } = await admin
      .from('rate_limit_events')
      .select('ts', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gt('ts', windowStartISO);

    if (cntErr) {
      console.error('[ratelimit] COUNT failed – falling open:', cntErr.message);
      return false;
    }

    // --- STAGE 2 FIX: Self-cleaning mechanism ---
    // As a fallback for when pg_cron is not available, we probabilistically
    // clean up old records. This fire-and-forget delete operation runs
    // occasionally and does not block the function's response.
    if (Math.random() < 0.1) { // 10% chance to run cleanup
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        admin
            .from('rate_limit_events')
            .delete()
            .lt('ts', tenMinutesAgo)
            .then(({ error }) => {
                if (error) {
                    console.warn('[ratelimit] Self-cleanup failed:', error.message);
                }
            });
    }
    // --- END STAGE 2 FIX ---

    return (count ?? 0) >= maxCalls;

  } catch (err) {
    console.error('[ratelimit] Unexpected error – falling open:', err.message);
    return false;
  }
}
