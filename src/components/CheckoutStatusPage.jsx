// ─────────────────────────────────────────────
// file: src/components/CheckoutStatusPage.jsx
// ─────────────────────────────────────────────
import { useEffect, useState } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.js';
import Toast from './Toast.jsx';

/* ───────── helper ───────── */
const fetchSubscriptionStatus = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status')
    .in('status', ['trialing', 'active'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();                //  ⇐ CHANGED

  if (error) throw new Error(error.message);
  return data;                     // null when no live row
};

export default function CheckoutStatusPage() {
  const [msg, setMsg] = useState('Verifying your subscription…');

  const { data, error } = useQuery({
    queryKey : ['subscriptionStatus'],
    queryFn  : fetchSubscriptionStatus,
    refetchInterval    : 2000,   // poll every 2 s
    refetchOnWindowFocus: false,
  });

  /* redirect on success */
  useEffect(() => {
    if (data?.status === 'active' || data?.status === 'trialing') {
      setMsg('Success! Redirecting…');
      Toast('Payment successful – welcome to Konzuko Pro!', 5000);
      setTimeout(() => (window.location.href = '/'), 2000);
    }
  }, [data]);

  /* 30-second timeout */
  useEffect(() => {
    const id = setTimeout(() => {
      if (!data) setMsg('Still processing… please refresh or contact support.');
    }, 30000);
    return () => clearTimeout(id);
  }, [data]);

  if (error) {
    return (
      <div className="full-page-center">
        <h1 style={{ color: 'var(--error)' }}>Error</h1>
        <p>{error.message}</p>
      </div>
    );
  }

  return (
    <div className="full-page-center">
      <h1>{msg}</h1>
      <div className="loading-dots" style={{ marginTop: '1rem' }}>
        <div className="dot"></div><div className="dot"></div><div className="dot"></div>
      </div>
    </div>
  );
}
