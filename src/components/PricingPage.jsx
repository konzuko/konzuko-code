// src/components/PricingPage.jsx
import { useState } from 'preact/hooks';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '../lib/supabase.js';
import { STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_ID } from '../config.js';
import Toast from './Toast.jsx';

// FIX: Add a check to ensure environment variables are loaded.
const areStripeKeysMissing = !STRIPE_PUBLISHABLE_KEY || !STRIPE_PRICE_ID;
const stripePromise = areStripeKeysMissing ? null : loadStripe(STRIPE_PUBLISHABLE_KEY);

if (areStripeKeysMissing) {
  console.error("Stripe configuration is missing. Ensure VITE_STRIPE_PUBLISHABLE_KEY and VITE_STRIPE_PRICE_ID are set in your .env file and the dev server is restarted.");
}

export default function PricingPage() {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (areStripeKeysMissing) {
      Toast('Stripe is not configured correctly. Please contact support.', 6000);
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { priceId: STRIPE_PRICE_ID },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const stripe = await stripePromise;
      const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: data.sessionId });

      if (stripeError) {
        throw stripeError;
      }
    } catch (err) {
      Toast(`Checkout failed: ${err.message}`, 5000);
      setLoading(false);
    }
  };

  return (
    <div className="full-page-center">
      <h1 className="pricing-page-title">Unlock Konzuko Code</h1>
      <p className="pricing-page-subtitle">
        Subscribe to get full access to all features, unlimited tasks, and priority support.
      </p>
      <div className="pricing-card">
        <h2 className="pricing-card-title">Pro Plan</h2>
        <p className="pricing-card-price">
          $10<span className="pricing-card-price-period">/mo</span>
        </p>
        <button
          className="button pricing-subscribe-button"
          onClick={handleCheckout}
          disabled={loading || areStripeKeysMissing}
          title={areStripeKeysMissing ? "Stripe configuration is missing." : ""}
        >
          {loading ? 'Redirecting...' : 'Subscribe Now'}
        </button>
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
