import { supabase } from './lib/supabase.js'

/* ──────────────────────────────
   1.  OpenAI Chat Completion
──────────────────────────────── */
export async function callApiForText({ messages, apiKey, model = 'o3-mini-high' }) {
  try {
    const formatted = messages.map(m => Array.isArray(m.content)
      ? m
      : { role: m.role === 'system' ? 'developer' : m.role,
          content: [{ type: 'text', text: m.content }] })

    const body = { model, messages: formatted, response_format: { type: 'text' } }
    if (/o3-mini|o1|o3/.test(model)) body.reasoning_effort = 'high'

    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 11 * 60 * 1000)

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body   : JSON.stringify(body),
      signal : ctrl.signal
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      let text = await res.text()
      try { text = JSON.parse(text).error?.message || text } catch {}
      return { error: `HTTP ${res.status}: ${text}` }
    }
    const data = await res.json()
    return data.error ? { error: data.error.message }
                      : { content: data.choices?.[0]?.message?.content || '' }
  } catch (err) { return { error: err.message } }
}

/* ──────────────────────────────
   2.  Supabase CRUD
──────────────────────────────── */
async function currentUser() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')
  return session.user
}

export async function fetchChats() {
  const user = await currentUser()
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchMessages(chat_id) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chat_id)
    .eq('archived', false)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createChat({ title = 'New Chat', model = 'javascript' }) {
  const user = await currentUser()
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function createMessage({ chat_id, role, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id, role, content })
    .single()
  if (error) throw error
  return data
}

/* ──────────────────────────────
   3.  Edit & Archive Helpers
──────────────────────────────── */
export async function updateMessage(message_id, newContent) {
  const { data, error } = await supabase
    .from('messages')
    .update({ content: [{ type: 'text', text: newContent }] })
    .eq('id', message_id)
    .single()
  if (error) throw error
  return data
}

export async function archiveMessagesAfter(chat_id, message_id) {
  const { data, error } = await supabase
    .from('messages')
    .update({ archived: true })
    .eq('chat_id', chat_id)
    .gt('id', message_id)
  if (error) throw error
  return data
}