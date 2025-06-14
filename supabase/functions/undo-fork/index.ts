// file: supabase/functions/undo-fork/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error("User not authenticated");

    const { messageId, originalContent, chatId, anchorCreatedAt } = await req.json();

    if (!messageId || !originalContent || !chatId || !anchorCreatedAt) {
      throw new Error('Missing required parameters for undo-fork.');
    }

    // CRITICAL FIX: Verify that the chat belongs to the authenticated user before proceeding.
    const { data: chat, error: ownerError } = await supabaseAdmin
      .from('chats')
      .select('user_id')
      .eq('id', chatId)
      .single();

    if (ownerError) throw ownerError;
    if (chat?.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }
    // END FIX

    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ content: originalContent, updated_at: new Date().toISOString() })
      .eq('id', messageId);

    if (updateError) throw updateError;

    const { error: unarchiveError } = await supabaseAdmin
      .from('messages')
      .update({ deleted_at: null })
      .eq('chat_id', chatId)
      .gt('created_at', anchorCreatedAt);

    if (unarchiveError) throw unarchiveError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('[undo-fork] ', err);
    return new Response(
      JSON.stringify({ error: err.message ?? 'Unexpected error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
