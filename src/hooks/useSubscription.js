// src/hooks/useSubscription.js
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './useAuth.js';

const fetchSubscription = async (userId) => {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .in('status', ['trialing', 'active'])
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    throw error;
  }
  return data;
};

export function useSubscription() {
  const { user } = useAuth();
  const {
    data: subscription,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: () => fetchSubscription(user?.id),
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  return {
    subscription,
    isActive: !!subscription,
    isLoading,
    error,
  };
}
