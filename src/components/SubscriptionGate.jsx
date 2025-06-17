// src/components/SubscriptionGate.jsx
import { useSubscription } from '../hooks/useSubscription.js';
import PricingPage from './PricingPage.jsx';

export default function SubscriptionGate({ children }) {
  const { isActive, isLoading, error } = useSubscription();

  if (isLoading) {
    return <div className="full-page-center">Verifying subscription…</div>;
  }

  if (error) {
    return <div className="full-page-center" style={{ color: 'var(--error)' }}>Error checking subscription: {error.message}</div>;
  }

  if (!isActive) {
    return <PricingPage />;
  }

  return children;
}
