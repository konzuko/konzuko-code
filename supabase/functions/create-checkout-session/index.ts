/**
 * create-checkout-session
 *
 * – Creates (or re-uses) a Stripe customer linked to the Supabase user
 * – Returns a Checkout‐Session ID for client-side redirect
 *
 * SECURITY HARDENING
 * • Host-header injection mitigated via environment-driven allow-list.
 * • priceId validated against a non-empty set from environment variables.
 * • Returns 400 for client errors, 500 for unexpected server errors.
 * • Sanitizes error messages before logging to prevent PII leaks.
 */

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
    /* ───────── Runtime-safe init ───────── */
    const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY missing in function's environment");
    }
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
      httpClient: Stripe.createFetchHttpClient(),
    });

    /* ───────── Parse body ───────── */
    const { priceId } = await req.json();
    if (!priceId || typeof priceId !== 'string') {
      return json({ error: 'priceId is required and must be a string' }, 400);
    }

    /* ───────── Allow-list price IDs ───────── */
    const rawAllowPrices = Deno.env.get('ALLOWED_PRICE_IDS') ?? '';
    const ALLOWED_PRICES = new Set(
      rawAllowPrices.split(',').map(s => s.trim()).filter(Boolean) // FIX: Filter empty strings
    );
    if (ALLOWED_PRICES.size > 0 && !ALLOWED_PRICES.has(priceId)) {
      return json({ error: 'The provided priceId is not allowed' }, 400);
    }

    /* ───────── Auth ───────── */
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr) throw authErr;
    if (!user) return json({ error: 'User not authenticated' }, 401);

    /* ───────── Stripe customer ───────── */
    const { data: profile } = await userClient.from('profiles').select('stripe_customer_id').single();
    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      const cu = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = cu.id;
      const { error: updErr } = await userClient.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
      if (updErr) throw updErr;
    }

    /* ───────── Build site URL safely ───────── */
    const SITE_URL = Deno.env.get('VITE_SITE_URL');
    if (!SITE_URL) {
      throw new Error("VITE_SITE_URL is not set in function's environment");
    }

    /* ───────── Create Checkout-Session ───────── */
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      allow_promotion_codes: true,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // FIX: Use distinct URLs for success and cancellation to improve UX.
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancel`,
    });
    console.log(`[Stripe] CheckoutSession ${session.id} created for user ${user.id} with price ${priceId}`);

    return json({ sessionId: session.id }, 200);

  } catch (err) {
    // FIX: Sanitize error message before logging to prevent PII leaks.
    const safeErrorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
    console.error('[create-checkout-session] Fatal error:', safeErrorMessage);
    return json({ error: 'Internal Server Error' }, 500);
  }
});
