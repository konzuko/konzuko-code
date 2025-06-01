import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

function getClient(req: Request): SupabaseClient {
  const url  = Deno.env.get('SUPABASE_URL')      ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const jwt  = req.headers.get('Authorization');           // “Bearer …”

  if (!jwt)              throw new Error('Missing Authorization header');
  if (!url || !anon)     throw new Error('Missing Supabase env vars');

  return createClient(url, anon, { global: { headers: { Authorization: jwt } } });
}

serve(async (req: Request): Promise<Response> => {
  /* CORS pre-flight */
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase = getClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error(authErr?.message || 'User not authenticated');

    /* GET  →  return saved API key */
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('api_key')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;      // real SQL error
      return new Response(
        JSON.stringify({ apiKey: data?.api_key ?? '' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    /* POST →  save / clear key */
    if (req.method === 'POST') {
      const { apiKey = '' } = await req.json().catch(() => ({}));

      if (typeof apiKey !== 'string') {
        return new Response(
          JSON.stringify({ error: 'apiKey must be a string' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const trimmed = apiKey.trim();
      if (
        trimmed !== '' &&
        !/^[A-Za-z0-9_\-]{30,60}$/.test(trimmed)
      ) {
        return new Response(
          JSON.stringify({ error: 'Invalid API-key format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { error } = await supabase
        .from('user_api_keys')
        .upsert({ user_id: user.id, api_key: trimmed }, { onConflict: 'user_id' });

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: 'Saved' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    /* Any other verb */
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[manage-api-key] ', err);
    return new Response(
      JSON.stringify({ error: err.message ?? 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
