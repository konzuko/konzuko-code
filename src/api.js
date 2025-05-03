import { supabase }          from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS } from './config.js'

const isoNow = () => new Date().toISOString()

let _cachedUser = null
export async function getCurrentUser ({ forceRefresh = false } = {}) {
  if (_cachedUser && !forceRefresh) return _cachedUser
  const { data:{ session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.user) throw new Error('Not authenticated')
  _cachedUser = session.user
  return _cachedUser
}

/** 
 * Send chat.messages (including image_url objects)
 * to a vision‐capable model (e.g. "gpt-4o"), and if it's one of your 
 * mini/O1/O3 models, request a higher reasoning effort.
 */
export async function callApiForText({
  messages,
  apiKey,
  model = 'gpt-4o',
  signal
}) {
  try {
    // re‐format each message into [{type, text}, ...]
    const formatted = messages.map(m => ({
      role:    m.role === 'system' ? 'developer' : m.role,
      content: Array.isArray(m.content)
        ? m.content
        : [{ type:'text', text: m.content }]
    }))

    const body = {
      model,
      messages: formatted,
      response_format: { type:'text' }
    }

    // if model is an o1/o3/o4 variant, add reasoning_effort: 'high'
    if (
      model.includes('o3-mini') ||
      model.includes('o3') ||
      model.includes('o1') ||
      model.includes('o4-mini')
    ) {
      body.reasoning_effort = 'high'
    }

    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS)
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${apiKey}`
      },
      body:   JSON.stringify(body),
      signal: signal ?? ctrl.signal
    })
    clearTimeout(timer)

    if (!res.ok) {
      let txt = await res.text()
      try {
        txt = JSON.parse(txt).error?.message || txt
      } catch {}
      return { error: `HTTP ${res.status}: ${txt}` }
    }

    const data = await res.json()
    return data.error
      ? { error: data.error.message }
      : { content: data.choices?.[0]?.message?.content ?? '' }
  }
  catch (err) {
    if (err.name === 'AbortError') {
      return { error: 'Request timed out' }
    }
    return { error: err.message }
  }
}

// ─── Chats CRUD ───────────────────────────────────────────────────────────────
export async function fetchChats() {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createChat({ title = 'New Chat', model = 'javascript' }) {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateChatTitle(id, newTitle) {
  const { error } = await supabase
    .from('chats')
    .update({ title: newTitle })
    .eq('id', id)
  if (error) throw error
  return { success: true }
}

export async function deleteChat(id) {
  const { error } = await supabase
    .from('chats')
    .update({ deleted_at: isoNow() })
    .eq('id', id)
  if (error) throw error
  return { success: true }
}

export async function undoDeleteChat(id) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('chats')
    .update({ deleted_at: null })
    .eq('id', id)
    .gt('deleted_at', cutoff)
  if (error) throw error

  const { error: msgErr } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('chat_id', id)
    .gt('deleted_at', cutoff)

  if (msgErr) throw msgErr
  return { success: true }
}

// ─── Messages CRUD ────────────────────────────────────────────────────────────
export async function fetchMessages(chat_id) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chat_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createMessage({ chat_id, role, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id, role, content })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMessage(id, newContent) {
  const { data, error } = await supabase
    .from('messages')
    .update({ content: [{ type:'text', text:newContent }] })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function archiveMessagesAfter(chat_id, message_id) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('id', message_id)
  if (error) throw error
  return { success: true }
}

export async function deleteMessage(id) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('id', id)
  if (error) throw error
  return { success: true }
}

export async function undoDeleteMessage(id) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('id', id)
    .gt('deleted_at', cutoff)
  if (error) throw error
  return { success: true }
}