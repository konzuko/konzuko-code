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
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const userClient = createClient(URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } }
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) throw authErr

    /* rate-limit */
    if (await isRateLimited(user.id, 'undo-fork')) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { messageId, originalContent, chatId, anchorCreatedAt } = await req.json()
    if (!messageId || !originalContent || !chatId || !anchorCreatedAt) {
      throw new Error('Missing required parameters')
    }

    /* ownership check */
    const { data: msg, error: ownErr } = await supabaseAdmin
      .from('messages')
      .select('chat_id, chats!inner(user_id)')
      .eq('id', messageId)
      .single()
    if (ownErr) throw ownErr
    if (msg?.chats?.user_id !== user.id || msg?.chat_id !== chatId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    /* restore anchor message */
    const { error: updErr } = await supabaseAdmin
      .from('messages')
      .update({ content: originalContent, updated_at: new Date().toISOString() })
      .eq('id', messageId)
    if (updErr) throw updErr

    /* un-archive subsequent messages */
    const { error: unarcErr } = await supabaseAdmin
      .from('messages')
      .update({ deleted_at: null })
      .eq('chat_id', chatId)
      .gt('created_at', anchorCreatedAt)
    if (unarcErr) throw unarcErr

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('[undo-fork]', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Unexpected error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
