import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// This function can run under the user's JWT because RLS policies
// should grant the user SELECT access on their own images.
function getClient(req: Request): SupabaseClient {
  const url  = Deno.env.get('SUPABASE_URL')      ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const jwt  = req.headers.get('Authorization');

  if (!jwt) throw new Error('Missing Authorization header');
  if (!url || !anon) throw new Error('Missing Supabase env vars');

  return createClient(url, anon, { global: { headers: { Authorization: jwt } } });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase = getClient(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error(authErr?.message || 'User not authenticated');

    const { paths, expiresIn = 60 } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: '`paths` must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase.storage
      .from('images')
      .createSignedUrls(paths, expiresIn);

    if (error) throw error;

    // We will return a map of path -> signedUrl for easy lookup on the client.
    const urlMap = data.reduce((acc, item) => {
      if (item.signedUrl) {
        acc[item.path] = item.signedUrl;
      }
      return acc;
    }, {} as Record<string, string>);

    return new Response(JSON.stringify({ urlMap }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[get-signed-urls] ', err);
    return new Response(
      JSON.stringify({ error: err.message ?? 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
