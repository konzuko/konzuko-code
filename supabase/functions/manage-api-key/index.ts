// supabase/functions/manage-api-key/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const ADMIN_URL  = Deno.env.get('SUPABASE_URL')!;
const SRV_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY   = Deno.env.get('SUPABASE_ANON_KEY')!;

const supabaseAdmin: SupabaseClient = createClient(ADMIN_URL, SRV_ROLE);

function json (body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request): Promise<Response> => {
  /* ───────── CORS pre-flight ───────── */
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  /* ───────── Auth guard ───────── */
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Unauthenticated' }, 401);
  }

  const userClient = createClient(ADMIN_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();

  if (authErr || !user) {
    return json({ error: authErr?.message ?? 'User not authenticated' }, 401);
  }

  /* ───────── Simple rate-limit ───────── */
  if (await isRateLimited(user.id, 'manage-api-key')) {
    return json({ error: 'Too Many Requests' }, 429);
  }

  try {
    /* ───────── GET  – retrieve key ───────── */
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.rpc('get_user_api_key', {
        p_user_id: user.id,
      });

      /* Gracefully handle missing RPC (e.g. migration not run yet) */
      if (error?.code === '42883') {
        // undefined_function → treat as “no key set”
        return json({ apiKey: '' });
      }
      if (error) throw error;

      return json({ apiKey: data ?? '' });
    }

    /* ───────── POST – save / clear key ───────── */
    if (req.method === 'POST') {
      const { apiKey = '' } = await req.json().catch(() => ({}));
      if (typeof apiKey !== 'string') {
        return json({ error: '`apiKey` must be a string' }, 400);
      }

      const trimmed = apiKey.trim();
      if (
        trimmed !== '' &&
        !/^[A-Za-z0-9_\-]{30,60}$/.test(trimmed)
      ) {
        return json({ error: 'Invalid API-key format' }, 400);
      }

      const { error } = await supabaseAdmin.rpc('set_user_api_key', {
        p_user_id: user.id,
        p_api_key: trimmed,
      });

      /* Same fallback if migration missing */
      if (error?.code === '42883') {
        // insert/update directly into the table without encryption
        const { error: tblErr } = await supabaseAdmin
          .from('user_api_keys')
          .upsert({ user_id: user.id, api_key: trimmed }, { onConflict: 'user_id' });

        if (tblErr) throw tblErr;
        return json({ message: 'Saved (unencrypted fallback)' });
      }

      if (error) throw error;
      return json({ message: 'Saved' });
    }

    /* ───────── 405 for everything else ───────── */
    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('[manage-api-key] ', err);
    return json({ error: err?.message ?? 'Unexpected error' }, 500);
  }
});
