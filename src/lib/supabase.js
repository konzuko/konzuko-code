// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON in .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true
  }
})
