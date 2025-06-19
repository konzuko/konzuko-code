// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.3.0?target=deno';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/* ------------------------------------------------------------------ */
/*  Replace the whole handler                                         */
/* ------------------------------------------------------------------ */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    /* ------------------------------ ENV ----------------------------- */
    const STRIPE_KEY      = Deno.env.get('STRIPE_SECRET_KEY');
    const FALLBACK_SITE   = Deno.env.get('VITE_SITE_URL') ?? '';
    const ALLOWED_PRICE_S = Deno.env.get('ALLOWED_PRICE_IDS') ?? '';

    if (!STRIPE_KEY) throw new Error('STRIPE_SECRET_KEY not set');

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion : '2022-11-15',
      httpClient : Stripe.createFetchHttpClient(),
    });

    /* ------------------------------ BODY ---------------------------- */
    const { priceId, siteUrl } = await req.json().catch(() => ({}));

    if (!priceId) {
      return json({ error: '`priceId` required' }, 400);
    }

    /* Optional defensive allow-list */
    const ALLOWED = new Set(
      ALLOWED_PRICE_S.split(',')
                     .map((s) => s.trim())
                     .filter(Boolean)
    );
    if (ALLOWED.size && !ALLOWED.has(priceId)) {
      return json({ error: 'priceId not allowed' }, 400);
    }

    /* ------------------------------ Auth ---------------------------- */
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Not authenticated' }, 401);

    /* ------------------ Choose the redirect base ------------------- */
    let base = typeof siteUrl === 'string' && siteUrl.trim() !== ''
      ? siteUrl.trim()
      : FALLBACK_SITE.trim();

    if (!base) throw new Error('siteUrl missing and VITE_SITE_URL not set');

    /* VERY small sanity-check: must be http/https and no query/hash.  */
    try {
      const u = new URL(base);
      base = `${u.protocol}//${u.host}`;     // strip path/query/hash
    } catch {
      return json({ error: 'Invalid siteUrl' }, 400);
    }

    /* ------------------ Ensure Stripe customer --------------------- */
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const cu = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = cu.id;
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    /* -------------------- Create checkout session ------------------ */
    const session = await stripe.checkout.sessions.create({
      mode                  : 'subscription',
      payment_method_types  : ['card'],
      allow_promotion_codes : true,
      customer              : customerId,
      line_items            : [{ price: priceId, quantity: 1 }],
      success_url           : `${base}/checkout-status`,
      cancel_url            : base,
    });

    return json({ sessionId: session.id });

  } catch (err: any) {
    console.error('[create-checkout-session]', err.message);
    return json({ error: err.message ?? 'Server error' }, 500);
  }
});
