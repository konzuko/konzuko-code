// file: src/hooks/useAuth.js
import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';
import Toast from '../components/Toast.jsx'; // <-- FIX: Import Toast

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        // --- FIX: Add user-facing notification on session fetch failure ---
        console.warn('getSession error:', error.message);
        Toast(`Could not verify session: ${error.message}. Please check your connection.`, 6000);
        // --- END FIX ---
      }

      setUser(session?.user ?? null);
      setLoading(false);
    }
    init();

    // Listen for future sign-in/sign-out
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
