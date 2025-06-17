// file: src/hooks/useAuth.js
import { useState, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';
import Toast from '../components/Toast.jsx';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        setUser(session?.user ?? null);
      } catch (error) {
        // --- FIX: Add user-facing notification on session fetch failure ---
        console.error('getSession error:', error.message);
        Toast(`Could not verify session: ${error.message}. Please check your connection.`, 6000);
        // --- END FIX ---
      } finally {
        setLoading(false);
      }
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
