// src/components/AuthGate.jsx
import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../hooks/useAuth.js'
import SubscriptionGate from './SubscriptionGate.jsx'
import Toast from './Toast.jsx'

export default function AuthGate({ children }) {
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleMagicLink = async () => {
    if (!email) {
      Toast('Please enter your email address.', 3000);
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      Toast('Magic link sent to ' + email, 5000);
    } catch (error) { // FIX: Removed the incorrect '=>' from the catch block.
      Toast('Error: ' + error.message, 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      if (error.message.includes('already exists')) {
        Toast(`An account with this email already exists. Please sign in with the original method.`, 6000);
      } else {
        Toast(`Error signing in with Google: ${error.message}`, 5000);
      }
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="full-page-center">Authenticating…</div>
  }

  if (!user) {
    return (
      <div className="full-page-center">
        <div className="auth-form-container">
          <h2 className="auth-form-title">Sign In to Konzuko</h2>
          
          <div className="auth-oauth-buttons">
            <button className="button" onClick={handleGoogleAuth} disabled={isSubmitting}>Sign in with Google</button>
          </div>

          <div className="auth-divider">
            <hr className="auth-divider-line" />
            <span className="auth-divider-text">OR</span>
            <hr className="auth-divider-line" />
          </div>

          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onKeyPress={e => e.key === 'Enter' && handleMagicLink()}
            className="form-input auth-email-input"
            disabled={isSubmitting}
          />
          <button
            className="button auth-submit-button"
            onClick={handleMagicLink}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending...' : 'Send Magic Link'}
          </button>
        </div>
      </div>
    )
  }

  return <SubscriptionGate>{children}</SubscriptionGate>
}
