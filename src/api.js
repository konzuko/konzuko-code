import { supabase }          from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS } from './config.js'

/*────────────────────────────
  Cached session ⸺ avoids
  hitting IndexedDB & network
─────────────────────────────*/
let _cachedUser = null
export async function getCurrentUser ({ forceRefresh = false } = {}) {
  if (_cachedUser && !forceRefresh) return _cachedUser
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error)   throw error
  if (!session?.user) throw new Error('Not authenticated')
  _cachedUser = session.user
  return _cachedUser
}

/*────────────────────────────
  OpenAI chat completion
─────────────────────────────*/
export async function callApiForText ({
  messages,
  apiKey,
  model = 'o3-mini-high',
  signal
}) {
  try {
    const formatted = messages.map(m => Array.isArray(m.content)
      ? m
      : {
          role   : m.role === 'system' ? 'developer' : m.role,
          content: [{ type: 'text', text: m.content }]
        })

    const body = {
      model,
      messages: formatted,
      response_format: { type: 'text' },
      ...( /o[13]/.test(model) ? { reasoning_effort: 'high' } : {} )
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        Authorization  : `Bearer ${apiKey}`
      },
      body  : JSON.stringify(body),
      signal: signal ?? ctrl.signal
    })

    clearTimeout(timer)

    if (!res.ok) {
      let txt = await res.text()
      try { txt = JSON.parse(txt).error?.message || txt } catch {}
      return { error: `HTTP ${res.status}: ${txt}` }
    }
    const data = await res.json()
    return data.error
      ? { error: data.error.message }
      : { content: data.choices?.[0]?.message?.content ?? '' }
  } catch (err) {
    if (err.name === 'AbortError') return { error: 'Request timed out' }
    return { error: err.message }
  }
}

/*────────────────────────────
  Supabase helpers – unchanged
  except for getCurrentUser()
─────────────────────────────*/
export async function fetchChats () {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchMessages (chat_id) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chat_id)
    .eq('archived', false)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createChat ({ title = 'New Chat', model = 'javascript' }) {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function createMessage ({ chat_id, role, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id, role, content })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMessage (id, newContent) {
  const { data, error } = await supabase
    .from('messages')
    .update({ content: [{ type: 'text', text: newContent }] })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function archiveMessagesAfter (chat_id, message_id) {
  const { data, error } = await supabase
    .from('messages')
    .update({ archived: true })
    .eq('chat_id', chat_id)
    .gt('id', message_id)
  if (error) throw error
  return data
}