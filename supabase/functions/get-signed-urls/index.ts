// file: supabase/functions/get-signed-urls/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
        return json({ error: authErr?.message || 'User not authenticated' }, 401);
    }

    if (await isRateLimited(user.id, 'get-signed-urls')) {
      return json({ error: 'Too Many Requests' }, 429);
    }

    const { paths, expiresIn = 60 } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      return json({ error: '`paths` must be a non-empty array' }, 400);
    }

    // --- REFACTORED OWNERSHIP CHECK ---
    // Instead of a slow, broken DB query, we just check if each path
    // starts with the required user-specific prefix. This is fast,
    // secure, and works with the bucket RLS policy.
    for (const p of paths) {
        const requiredPrefix = `protected/${user.id}/`;
        if (typeof p !== 'string' || !p.startsWith(requiredPrefix)) {
            console.warn(`[get-signed-urls] Forbidden attempt by user ${user.id} for path: ${p}`);
            return json({ error: 'Forbidden: You do not own one or more of the requested resources.' }, 403);
        }
    }
    // --- END REFACTORED CHECK ---

    const { data, error } = await supabaseAdmin.storage
      .from('images')
      .createSignedUrls(paths, expiresIn);

    if (error) throw error;

    const urlMap = data.reduce((acc, item) => {
      if (item.signedUrl) {
        acc[item.path] = item.signedUrl;
      }
      return acc;
    }, {} as Record<string, string>);

    return json({ urlMap });

  } catch (err: any) {
    // Sanitize logs: do not log the full error object which might contain sensitive info.
    console.error('[get-signed-urls] Error:', err.message);
    return json({ error: err.message ?? 'Unexpected error' }, 500);
  }
});
