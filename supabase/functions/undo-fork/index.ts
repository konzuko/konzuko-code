// supabase/functions/undo-fork/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// This function requires admin privileges to modify the messages table reliably,
// so we use the SERVICE_ROLE_KEY. This is different from manage-api-key, which
// should run under the user's permissions.
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // First, ensure the user making the request is authenticated.
    // We create a separate client for this using their JWT.
    const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error("User not authenticated");

    // Now, proceed with the admin operations.
    const { messageId, originalContent, chatId, anchorCreatedAt } = await req.json();

    if (!messageId || !originalContent || !chatId || !anchorCreatedAt) {
      throw new Error('Missing required parameters for undo-fork.');
    }

    // Operation 1: Restore the original message content using the admin client
    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({ content: originalContent, updated_at: new Date().toISOString() })
      .eq('id', messageId);

    if (updateError) throw updateError;

    // Operation 2: Un-archive all subsequent messages using the admin client
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
