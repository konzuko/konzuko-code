/*───────────────────────────────────────────────────────────────────────────────
  supabase/functions/_shared/ratelimit.ts
  ---------------------------------------

  Drop-in replacement that works on every Supabase project *without* Deno KV.
  It stores a single row per request in a tiny Postgres table and counts how
  many requests fall inside the sliding window.

  • Table definition (run once in SQL editor or via migration):

      -----------------------------------------------------------------
      create table if not exists public.rate_limit_events (
        user_id   uuid        not null,
        endpoint  text        not null,
        ts        timestamptz not null default now()
      );
      create index if not exists rate_limit_events_idx
        on public.rate_limit_events (user_id, endpoint, ts);
      -----------------------------------------------------------------

  • No pg_cron required.  Old entries naturally age out of the window; you can
    add a scheduled purge later if you wish.

  • Fails **open** – if Postgres is unreachable the function never blocks users.

───────────────────────────────────────────────────────────────────────────────*/

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* ────────── initialise admin client (service-role) ────────── */
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Persist-session OFF → no localStorage / cookies in the Edge runtime
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_K, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

/* ────────── defaults ────────── */
const DEFAULT_WINDOW_MS  = 60_000          // 1 minute
const DEFAULT_MAX_CALLS  = 30              // 30 calls per window

/*──────────────────────────────────────────────────────────────────────────────
  isRateLimited()

  @param userId     UUID of the caller (auth.uid()).
  @param endpoint   Logical name of the endpoint, e.g. 'manage-api-key'.
  @param windowMs   Sliding-window size in milliseconds  (optional).
  @param maxCalls   Max requests allowed in that window (optional).

  @returns boolean  true  → limit exceeded, deny the request
                    false → under the limit, continue processing
──────────────────────────────────────────────────────────────────────────────*/
export async function isRateLimited(
  userId   : string,
  endpoint : string,
  windowMs = DEFAULT_WINDOW_MS,
  maxCalls = DEFAULT_MAX_CALLS,
): Promise<boolean> {
  try {
    /* 1) Record this call -------------------------------------------------- */
    const { error: insertErr } = await admin
      .from('rate_limit_events')
      .insert({ user_id: userId, endpoint })

    if (insertErr) {
      console.error('[ratelimit] INSERT failed – falling open:', insertErr)
      return false
    }

    /* 2) Count calls still inside the window ------------------------------ */
    const windowStartISO = new Date(Date.now() - windowMs).toISOString()

    const { count, error: cntErr } = await admin
      .from('rate_limit_events')
      .select('ts', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gt('ts', windowStartISO)

    if (cntErr) {
      console.error('[ratelimit] COUNT failed – falling open:', cntErr)
      return false
    }

    return (count ?? 0) >= maxCalls
  } catch (err) {
    console.error('[ratelimit] Unexpected error – falling open:', err)
    return false
  }
}
