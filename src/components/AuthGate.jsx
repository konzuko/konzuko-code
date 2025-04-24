import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../hooks/useAuth.js'

export default function AuthGate({ children }) {
  const { user, loading } = useAuth()
  const [email, setEmail] = useState('')

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}>Authenticating…</div>
  }

  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h2>Sign In</h2>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onInput={e => setEmail(e.target.value)}
          style={{ padding: '0.5rem', width: '100%', maxWidth: '300px' }}
        />
        <button
          className="button"
          style={{ marginTop: '1rem' }}
          onClick={async () => {
            const { error } = await supabase.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: window.location.origin }
            })
            if (error) alert('Error: ' + error.message)
            else alert('Magic link sent to ' + email)
          }}
        >
          Send Magic Link
        </button>
      </div>
    )
  }

  return children
}