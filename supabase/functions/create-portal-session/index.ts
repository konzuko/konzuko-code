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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const STRIPE_KEY    = Deno.env.get('STRIPE_SECRET_KEY');
    const FALLBACK_SITE = Deno.env.get('VITE_SITE_URL') ?? '';

    if (!STRIPE_KEY) throw new Error('STRIPE_SECRET_KEY not set');

    const { siteUrl } = await req.json().catch(() => ({}));

    let base = typeof siteUrl === 'string' && siteUrl.trim() !== ''
      ? siteUrl.trim()
      : FALLBACK_SITE.trim();

    if (!base) throw new Error('siteUrl missing and VITE_SITE_URL not set');

    /* strip path/query/hash */
    try { const u = new URL(base); base = `${u.protocol}//${u.host}`; } catch {
      return json({ error: 'Invalid siteUrl' }, 400);
    }

    const stripe = new Stripe(STRIPE_KEY, {
      apiVersion: '2022-11-15',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .single();

    if (!profile?.stripe_customer_id) {
      return json({ error: 'Stripe customer not found.' }, 400);
    }

    const { url } = await stripe.billingPortal.sessions.create({
      customer   : profile.stripe_customer_id,
      return_url : base,
    });

    return json({ url });

  } catch (err: any) {
    console.error('[create-portal-session]', err.message);
    return json({ error: err.message ?? 'Server error' }, 500);
  }
});
