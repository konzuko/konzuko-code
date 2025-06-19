// src/hooks/useSubscription.js
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './useAuth.js';

/* ------------------------------------------------------------------
   fetchSubscription
   – Returns the first ACTIVE / TRIALING subscription row (if any)
     **Works even when current_period_end is NULL**
-------------------------------------------------------------------*/
const fetchSubscription = async (userId) => {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .in('status', ['trialing', 'active'])
    // ⚠️  removed .order('current_period_end') because NULLs broke the limit(1)
    .limit(1)
    .maybeSingle();        // returns null instead of 406

  if (error) throw error;
  return data;             // null when nothing visible
};

export function useSubscription() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey : ['subscription', user?.id],
    queryFn  : () => fetchSubscription(user?.id),
    enabled  : !!user,
    refetchOnWindowFocus: false,
  });

  return {
    subscription : data,
    isActive     : !!data,   // truthy when row exists
    isLoading,
    error,
  };
}