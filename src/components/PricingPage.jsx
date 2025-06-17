// src/components/PricingPage.jsx
import { useState } from 'preact/hooks';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase.js';
import { STRIPE_PUBLISHABLE_KEY } from '../config.js';
import Toast from './Toast.jsx';

const areStripeKeysMissing = !STRIPE_PUBLISHABLE_KEY;
const stripePromise = areStripeKeysMissing ? null : loadStripe(STRIPE_PUBLISHABLE_KEY);

// ─────────────────────────────────────────────────────────────
// All available plans.  Replace the price IDs with your own.
// ─────────────────────────────────────────────────────────────
const plans = [
  {
    id: 'price_1Rb2d72RqNQ49lAwemcIcuUE',   // £35 / month
    name: 'Pro',
    price: '£35',
    period: '/mo',
    features: ['Unlimited Tasks', 'Full Context Window', 'Priority Support'],
  },
  {
    id: 'price_1Rb2d72RqNQ49lAwpG0LllTn',   // £50 / month
    name: 'Team',
    price: '£50',
    period: '/mo',
    features: ['All Pro Features', 'Team Collaboration', 'Centralised Billing'],
    isFeatured: true,
  },
];

export default function PricingPage() {
  const [loadingId, setLoadingId] = useState(null);

  async function handleCheckout(priceId) {
    if (areStripeKeysMissing) {
      Toast('Stripe is not configured in this environment.', 5000);
      return;
    }

    setLoadingId(priceId);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('User not authenticated');

      // ---- CUSTOM FETCH (no "apikey" header) ----
      const res = await fetch('/functions/v1/create-checkout-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ priceId }),
      });

      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error || `HTTP ${res.status}`);
      }

      const { sessionId } = await res.json();

      const stripe = await stripePromise;
      const { error: stripeErr } = await stripe.redirectToCheckout({ sessionId });
      if (stripeErr) throw stripeErr;
    } catch (err) {
      console.error(err);
      Toast(`Checkout failed: ${err.message}`, 6000);
      setLoadingId(null);
    }
  }

  return (
    <div className="full-page-center">
      <h1 className="pricing-page-title">Choose Your Plan</h1>

      <div className="pricing-grid">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`pricing-card ${plan.isFeatured ? 'featured' : ''}`}
          >
            <h2 className="pricing-card-title">{plan.name}</h2>
            <p className="pricing-card-price">
              {plan.price}
              <span className="pricing-card-price-period">{plan.period}</span>
            </p>

            <ul className="pricing-features-list">
              {plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            <button
              className={`button pricing-subscribe-button ${
                plan.isFeatured ? 'featured' : ''
              }`}
              disabled={loadingId === plan.id}
              onClick={() => handleCheckout(plan.id)}
            >
              {loadingId === plan.id ? 'Redirecting…' : 'Subscribe'}
            </button>
          </div>
        ))}
      </div>

      <button
        className="button pricing-signout-button"
        onClick={() => supabase.auth.signOut()}
      >
        Sign Out
      </button>
    </div>
  );
}
