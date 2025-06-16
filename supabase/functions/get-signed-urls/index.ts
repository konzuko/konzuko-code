import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isRateLimited } from '../_shared/ratelimit.ts'

const URL        = Deno.env.get('SUPABASE_URL')!
const SRV_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY   = Deno.env.get('SUPABASE_ANON_KEY')!

const supabaseAdmin: SupabaseClient = createClient(URL, SRV_ROLE)

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    /* auth (user JWT) */
    const userClient = createClient(URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } }
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) throw new Error(authErr?.message || 'Unauthenticated')

    /* rate-limit */
    if (await isRateLimited(user.id, 'get-signed-urls')) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    /* body parse + validation */
    const { paths, expiresIn = 60 } = await req.json()
    if (!Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: '`paths` must be a non-empty array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    /* make sure user owns every image */
    const { data: rows, error: ownErr } = await supabaseAdmin
      .from('messages')
      .select('content, chats!inner(user_id)')
      .in('content->image_url->>path', paths)
      .eq('chats.user_id', user.id)

    if (ownErr) throw ownErr
    if (rows.length !== paths.length) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    /* create signed URLs */
    const { data, error } = await supabaseAdmin.storage
      .from('images')
      .createSignedUrls(paths, expiresIn)
    if (error) throw error

    const urlMap = data.reduce((acc: Record<string,string>, row) => {
      if (row.signedUrl) acc[row.path] = row.signedUrl
      return acc
    }, {})

    return new Response(JSON.stringify({ urlMap }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('[get-signed-urls]', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Unexpected error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
