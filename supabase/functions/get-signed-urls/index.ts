// file: supabase/functions/get-signed-urls/index.ts
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

    if (await isRateLimited(user.id, 'get-signed-urls')) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { paths, expiresIn = 60 } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: '`paths` must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: ownedMessages, error: ownedError } = await supabaseAdmin
        .from('messages')
        .select('content, chats!inner(user_id)')
        .in('content->image_url->>path', paths)
        .eq('chats.user_id', user.id);

    if (ownedError) throw ownedError;

    if (ownedMessages.length !== paths.length) {
        return new Response(JSON.stringify({ error: 'Forbidden: You do not own one or more of the requested resources.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

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
