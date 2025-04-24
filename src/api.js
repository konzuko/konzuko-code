import { supabase } from './lib/supabase.js'

// 1) OpenAI chat completion (unchanged)
export async function callApiForText({ messages, apiKey, model = 'o3-mini-high' }) {
  try {
    console.log('Sending API request with model:', model)
    const formattedMessages = messages.map(m => {
      if (Array.isArray(m.content)) return m
      return {
        role: m.role === 'system' ? 'developer' : m.role,
        content: [{ type: 'text', text: m.content }]
      }
    })
    const requestBody = { model, messages: formattedMessages, response_format: { type: 'text' } }
    if (model.includes('o3-mini') || model.includes('o1') || model.includes('o3')) {
      requestBody.reasoning_effort = 'high'
    }
    console.log('Request body:', JSON.stringify(requestBody, null, 2))
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 11 * 60 * 1000)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      const errorText = await response.text()
      let errorDetails
      try { errorDetails = JSON.parse(errorText).error?.message || errorText } catch { errorDetails = errorText }
      return { error: `HTTP Error ${response.status}: ${errorDetails}`, status: response.status, details: errorText }
    }
    const data = await response.json()
    if (data.error) return { error: data.error.message }
    return { content: data.choices?.[0]?.message?.content || '' }
  } catch (err) {
    return { error: err.message }
  }
}

// 2) Supabase CRUD for chats & messages
export async function fetchChats() {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchMessages(chat_id) {
  const { data, error } = await supabase.from('messages').select('*').eq('chat_id', chat_id).order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createChat({ title = 'New Chat', model = 'Javascript' }) {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function createMessage({ chat_id, role, content }) {
  const { data, error } = await supabase.from('messages').insert({ chat_id, role, content }).single()
  if (error) throw error
  return data
}

// 3) One-off local→cloud migration
export async function migrateLocalChats() {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) throw new Error('Not authenticated')
  const raw = localStorage.getItem('konzuko-chats') || '[]'
  const localChats = JSON.parse(raw)
  for (const c of localChats) {
    const { data: chatRow, error: e1 } = await supabase
      .from('chats')
      .insert({ user_id: user.id, title: c.title, created_at: c.started })
      .select('id')
      .single()
    if (e1) throw e1
    const rows = c.messages.map(m => ({
      chat_id: chatRow.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at || new Date().toISOString()
    }))
    const { error: e2 } = await supabase.from('messages').insert(rows, { returning: 'minimal' })
    if (e2) throw e2
  }
  localStorage.removeItem('konzuko-chats')
  alert('✅ Imported all local chats into Supabase!')
}
