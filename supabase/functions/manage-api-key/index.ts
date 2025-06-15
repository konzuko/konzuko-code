// file: supabase/functions/manage-api-key/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

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
    if (authErr || !user) throw new Error(authErr?.message || 'User not authenticated');

    if (await isRateLimited(user.id, 'manage-api-key')) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.rpc('get_user_api_key', { p_user_id: user.id });
      if (error) throw error;
      return new Response(
        JSON.stringify({ apiKey: data ?? '' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (req.method === 'POST') {
      const { apiKey = '' } = await req.json().catch(() => ({}));
      if (typeof apiKey !== 'string') {
        return new Response(JSON.stringify({ error: 'apiKey must be a string' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const trimmed = apiKey.trim();
      if (trimmed !== '' && !/^[A-Za-z0-9_\-]{30,60}$/.test(trimmed)) {
        return new Response(JSON.stringify({ error: 'Invalid API-key format' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { error } = await supabaseAdmin.rpc('set_user_api_key', { p_user_id: user.id, p_api_key: trimmed });
      if (error) throw error;

      return new Response(JSON.stringify({ message: 'Saved' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[manage-api-key] ', err);
    return new Response(JSON.stringify({ error: err.message ?? 'Unexpected error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
