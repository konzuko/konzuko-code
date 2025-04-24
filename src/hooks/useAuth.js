
import { useState, useEffect } from 'preact/hooks'
import { supabase } from '../lib/supabase.js'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) console.warn('getSession error:', error.message)

      setUser(session?.user ?? null)
      setLoading(false)
    }
    init()

    // Listen for future sign-in/sign-out
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}

