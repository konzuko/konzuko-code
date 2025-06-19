// src/components/AuthGate.jsx
import { useState, useCallback } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../hooks/useAuth.js';
import SubscriptionGate from './SubscriptionGate.jsx';
import Toast from './Toast.jsx';

// A simple regex for email validation.
const EMAIL_VALIDATION_PATTERN = ".+@.+\\..+";

export default function AuthGate({ children }) {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleMagicLink = useCallback(async (event) => {
    // Prevent default form submission which reloads the page.
    event.preventDefault();

    // The 'required' attribute on the input handles the empty case.
    if (!email) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      Toast('Magic link sent to ' + email, 5000);
    } catch (error) {
      Toast('Error: ' + error.message, 5000);
    } finally {
      setIsSubmitting(false);
    }
  }, [email]);

  const handleGoogleAuth = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      // If there's an error, the user stays on the page, so we need to handle it.
      // If successful, Supabase handles the redirect, so no 'finally' is needed here.
      if (error) {
        // This string matching is fragile but a common pattern for this specific Supabase error.
        if (error.message.includes('already exists')) {
          Toast(`An account with this email already exists. Please sign in with the original method.`, 6000);
        } else {
          Toast(`Error signing in with Google: ${error.message}`, 5000);
        }
        setIsSubmitting(false);
      }
    } catch (error) {
      // Catch any unexpected errors during the setup of the OAuth call.
      Toast(`An unexpected error occurred: ${error.message}`, 5000);
      setIsSubmitting(false);
    }
  }, []);

  if (loading) {
    return <div className="full-page-center">Authenticating…</div>;
  }

  if (!user) {
    return (
      <div className="full-page-center">
        <div className="auth-form-container">
          <h2 className="auth-form-title">Sign In to Konzuko</h2>

          <div className="auth-oauth-buttons">
            <button className="button" onClick={handleGoogleAuth} disabled={isSubmitting}>
              Sign in with Google
            </button>
          </div>

          <div className="auth-divider">
            <hr className="auth-divider-line" />
            <span className="auth-divider-text">OR</span>
            <hr className="auth-divider-line" />
          </div>

          <form onSubmit={handleMagicLink}>
            <fieldset disabled={isSubmitting} style={{ border: 'none', padding: 0, margin: 0 }}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onInput={e => setEmail(e.target.value)}
                className="form-input auth-email-input"
                required
                pattern={EMAIL_VALIDATION_PATTERN}
                title="Please enter a valid email address."
              />
              <button
                type="submit"
                className="button auth-submit-button"
              >
                {isSubmitting ? 'Sending...' : 'Send Magic Link'}
              </button>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  return <SubscriptionGate>{children}</SubscriptionGate>;
}
