
import { supabase }          from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS } from './config.js'

// Helper to get an ISO string of the current date/time.
const isoNow = () => new Date().toISOString()

// ───────────────────────────────────────────────────────────────────────────
// AUTH: Retrieve current logged-in user from Supabase session
// ───────────────────────────────────────────────────────────────────────────
let _cachedUser = null

export async function getCurrentUser({ forceRefresh = false } = {}) {
  if (_cachedUser && !forceRefresh) return _cachedUser

  const {
    data: { session },
    error
  } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.user) throw new Error('Not authenticated')

  _cachedUser = session.user
  return _cachedUser
}

// ───────────────────────────────────────────────────────────────────────────
// OPENAI: Chat completion with vision blocks.
// ───────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {Array<{role:("system"|"user"|"assistant"),content:string|Array}>} opts.messages
 * @param {string} opts.apiKey - Your OpenAI API key
 * @param {string} [opts.model] - Defaults to "o1"
 * @param {AbortSignal} [opts.signal]
 *
 * @returns {Promise<{content?:string, error?:string, status?:number, details?:string}>}
 */
export async function callApiForText({
  messages,
  apiKey,
  model = 'o1',
  signal
}) {
  // 1) Reformat every message to ensure content is an array of blocks
  const formatted = messages.map(m => ({
    // must be "system", "user", or "assistant"
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content) }]
  }))

  // 2) Build request body. Use an object for response_format
  const body = {
    model,
    messages: formatted,
    response_format: { type: 'text' }
  }

  // 3) For certain O-series models, request higher reasoning effort
  if (
    model.includes('o1')      ||
    model.includes('o3-mini') ||
    model.includes('o3')      ||
    model.includes('o4-mini')
  ) {
    body.reasoning_effort = 'high'
  }

  // 4) Issue the POST with a hard timeout
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body:   JSON.stringify(body),
      signal: signal ?? controller.signal
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      // parse text or JSON
      let txt = await res.text()
      try {
        const parsed = JSON.parse(txt)
        txt = parsed.error?.message || txt
      } catch {}
      return {
        error:   `HTTP ${res.status}: ${txt}`,
        status:  res.status,
        details: txt
      }
    }

    const data = await res.json()
    if (data.error) {
      return { error: data.error.message }
    }

    return {
      content: data.choices?.[0]?.message?.content || ''
    }

  } catch (err) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      return { error: 'Request timed out' }
    }
    return { error: err.message }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// CHATS CRUD
// ───────────────────────────────────────────────────────────────────────────
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

export async function createChat({ title = 'New Chat', model = 'o1' }) {
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

  // also restore all messages that were recently deleted
  const { error: msgErr } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('chat_id', id)
    .gt('deleted_at', cutoff)
  if (msgErr) throw msgErr

  return { success: true }
}

// ───────────────────────────────────────────────────────────────────────────
// MESSAGES CRUD
// ───────────────────────────────────────────────────────────────────────────
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
  // store as an array of blocks for consistency
  const { data, error } = await supabase
    .from('messages')
    .update({ content: [{ type: 'text', text: newContent }] })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/*
   Updated to archive by created_at rather than numeric id:
*/
export async function archiveMessagesAfter(chat_id, anchorCreatedAt) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt)
  if (error) throw error
  return { success: true }
}

// NEW: Re-add the missing function
export async function undoArchiveMessagesAfter(chat_id, anchorCreatedAt) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt)
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

