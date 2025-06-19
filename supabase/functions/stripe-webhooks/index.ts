/**********************************************************************
 *  Stripe ⇄ Supabase webhook  (Option A – columns are nullable)
 *  • Assumes subscriptions.current_period_* now allow NULL
 *  • Very small, still logs to stripe_webhook_debug on errors
 *********************************************************************/

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.3.0?target=deno";

/* ── required Vault env vars ── */
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SIGNING_SECRET,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
} = Deno.env.toObject();

["STRIPE_SECRET_KEY",
 "STRIPE_WEBHOOK_SIGNING_SECRET",
 "SUPABASE_URL",
 "SERVICE_ROLE_KEY"].forEach((k) => {
  if (!Deno.env.get(k)) throw new Error(`Missing ${k} in Vault`);
});

/* ── clients ── */
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* ── helpers ── */
const iso = (s: number | null) => (s ? new Date(s * 1e3).toISOString() : null);
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function logDebug(row: Record<string, unknown>) {
  await sb.from("stripe_webhook_debug").insert(row);
}

async function getProfileId(customer: Stripe.Customer) {
  const stripeId = customer.id;
  const userMeta = customer.metadata?.user_id as string | undefined;

  let { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", stripeId)
    .maybeSingle();

  if (!profile && userMeta) {
    const { data } = await sb
      .from("profiles")
      .upsert({ id: userMeta, stripe_customer_id: stripeId }, { onConflict: "id" })
      .select("id")
      .single();
    profile = data;
  }

  if (!profile) {
    throw new Error(
      `No profile for customer ${stripeId}. Make sure checkout saves stripe_customer_id.`
    );
  }
  return profile.id as string;
}

async function upsertSub(sub: Stripe.Subscription) {
  const customer =
    typeof sub.customer === "string"
      ? await stripe.customers.retrieve(sub.customer)
      : (sub.customer as Stripe.Customer);

  const userId = await getProfileId(customer);

  /* direct mapping (columns now NULL-able) */
  const row = {
    id                   : sub.id,
    user_id              : userId,
    status               : sub.status,
    price_id             : sub.items.data[0].price.id,
    quantity             : sub.items.data[0].quantity,
    cancel_at_period_end : sub.cancel_at_period_end,
    metadata             : sub.metadata,
    created              : iso(sub.created),
    current_period_start : iso(sub.current_period_start),
    current_period_end   : iso(sub.current_period_end),
    ended_at             : iso(sub.ended_at),
    cancel_at            : iso(sub.cancel_at),
    canceled_at          : iso(sub.canceled_at),
    trial_start          : iso(sub.trial_start),
    trial_end            : iso(sub.trial_end),
  };

  const { error } = await sb.from("subscriptions").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
}

/* ── main handler ── */
serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get("Stripe-Signature");

  /* signature */
  let evt: Stripe.Event;
  try {
    evt = await stripe.webhooks.constructEventAsync(raw, sig!, STRIPE_WEBHOOK_SIGNING_SECRET);
  } catch (err) {
    await logDebug({ event_type: "signature_error", payload: raw, error_text: err.message });
    return j({ error: "Invalid signature" }, 400);
  }

  try {
    switch (evt.type) {
      case "checkout.session.completed": {
        const s = evt.data.object as Stripe.Checkout.Session;
        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertSub(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertSub(evt.data.object as Stripe.Subscription);
        break;
      default:
        await logDebug({ stripe_event_id: evt.id, event_type: evt.type, payload: evt.data.object });
    }
    return j({ received: true });
  } catch (err) {
    await logDebug({
      stripe_event_id: evt.id,
      event_type: evt.type,
      payload: evt.data.object,
      error_text: err.message,
    });
    return j({ error: err.message }, 500);
  }
});