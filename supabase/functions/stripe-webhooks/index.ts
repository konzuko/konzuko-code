// supabase/functions/stripe-webhooks/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.3.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const toTimestamp = (epoch: number) => new Date(epoch * 1000).toISOString();

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET')!
    );
  } catch (err) {
    console.error(err.message);
    return new Response(err.message, { status: 400 });
  }

  try {
    const subscription = event.data.object as Stripe.Subscription;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', subscription.customer)
      .single();

    if (!profile) throw new Error('Profile not found for customer');

    const subscriptionData = {
      id: subscription.id,
      user_id: profile.id,
      metadata: subscription.metadata,
      status: subscription.status,
      price_id: subscription.items.data[0].price.id,
      quantity: subscription.items.data[0].quantity,
      cancel_at_period_end: subscription.cancel_at_period_end,
      created: toTimestamp(subscription.created),
      current_period_start: toTimestamp(subscription.current_period_start),
      current_period_end: toTimestamp(subscription.current_period_end),
      ended_at: subscription.ended_at ? toTimestamp(subscription.ended_at) : null,
      cancel_at: subscription.cancel_at ? toTimestamp(subscription.cancel_at) : null,
      canceled_at: subscription.canceled_at ? toTimestamp(subscription.canceled_at) : null,
      trial_start: subscription.trial_start ? toTimestamp(subscription.trial_start) : null,
      trial_end: subscription.trial_end ? toTimestamp(subscription.trial_end) : null,
    };

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .upsert(subscriptionData, { onConflict: 'id' });

    if (error) throw error;

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (error) {
    console.error('Webhook handler failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
});
