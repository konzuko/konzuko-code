// file: src/api/supabaseApi.js
/* src/api/supabaseApi.js */
import { supabase } from '../lib/supabase.js';
import { GEMINI_MODEL_NAME } from '../config.js';

export const CHATS_PAGE_LIMIT = 20;

const isoNow = () => new Date().toISOString();

export async function getCurrentUser() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error('Not authenticated');
  return session.user;
}

export async function fetchChats({ pageParam = 1 }) {
  const user = await getCurrentUser();
  const limit = CHATS_PAGE_LIMIT;
  const offset = (pageParam - 1) * limit;
  const { data, error, count } = await supabase
    .from('chats').select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { throw error; }
  const hasMore = (pageParam * limit) < (count || 0);
  return {
    chats: data || [],
    nextCursor: hasMore ? pageParam + 1 : undefined,
    totalCount: count || 0,
    currentPage: pageParam
  };
}

export async function createChat({ title = 'New Task', model = GEMINI_MODEL_NAME }) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateChatTitle(id, newTitle) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('chats')
    .update({ title: newTitle })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChat(id) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('chats')
    .update({ deleted_at: isoNow() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) throw error;
  return { success: true, id };
}

export async function undoDeleteChat(id) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('chats')
    .update({ deleted_at: null })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchMessages(chat_id) {
  if (!chat_id) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chat_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createMessage({ chat_id, role, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMessage(id, newContent) {
  const { data, error } = await supabase
    .from('messages')
    .update({ content: newContent, updated_at: isoNow() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function archiveMessagesAfter(chat_id, anchorCreatedAt) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt);
  if (error) throw error;
  return { success: true };
}

export async function performUndoFork({ messageId, originalContent, chatId, anchorCreatedAt }) {
  const { data, error } = await supabase.functions.invoke('undo-fork', {
    body: { messageId, originalContent, chatId, anchorCreatedAt },
  });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  return data;
}

export async function deleteMessage(id) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('id', id);
  if (error) throw error;
  return { success: true, id };
}

export async function undoDeleteMessage(id) {
  const { data, error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
