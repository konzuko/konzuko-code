// supabase/functions/create-portal-session/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.3.0?target=deno';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY missing in function's environment");
    }
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'User not authenticated' }, 401);

    const { data: profile } = await userClient
      .from('profiles')
      .select('stripe_customer_id')
      .single();

    if (!profile?.stripe_customer_id) {
      return json({ error: 'Stripe customer not found for this user.' }, 400);
    }

    // FIX: Enforce the use of a validated SITE_URL from environment variables.
    const SITE_URL = Deno.env.get('VITE_SITE_URL');
    if (!SITE_URL) {
      throw new Error("VITE_SITE_URL is not set in function's environment");
    }

    const { url } = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: SITE_URL,
    });

    return json({ url }, 200);
  } catch (err) {
    const safeErrorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
    console.error('[create-portal-session] Fatal error:', safeErrorMessage);
    return json({ error: 'Internal Server Error' }, 500);
  }
});
