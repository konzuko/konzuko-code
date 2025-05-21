/* ======================================================================
   File: src/api.js
====================================================================== */

console.log('API.JS FILE LOADED (for @google/genai & TanStack Query) - VERSION TQ_002_UNDO - TIMESTAMP', new Date().toISOString());

import { supabase }                      from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS }             from './config.js'
import {
    GoogleGenAI,
    HarmCategory,
    HarmBlockThreshold,
} from "@google/genai";

export const GEMINI_MODEL_NAME = "gemini-2.5-pro-preview-05-06";
export const CHATS_PAGE_LIMIT = 20;

const isoNow = () => new Date().toISOString()

// ... (validateKey, convertImageUrlToPart, getCurrentUser, callApiForText - remain unchanged) ...
function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    const errorMsg = 'Gemini API key missing or malformed.\n' +
    'It should be 30-60 characters. Copy from Google AI Studio or Google Cloud.';
    throw new Error(errorMsg);
  }
  return key;
}

async function convertImageUrlToPart(imageUrlBlock) {
    if (!imageUrlBlock.image_url || !imageUrlBlock.image_url.url) {
        return { text: `[Invalid image_url block]` };
    }
    try {
        const res = await fetch(imageUrlBlock.image_url.url);
        if (!res.ok) throw new Error(`Fetch ${res.status} from ${imageUrlBlock.image_url.url}`);
        const blob = await res.blob();
        const base64 = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onloadend = () => resolve(fr.result.split(',')[1]);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
        return {
            inlineData: {
                mimeType: blob.type || 'application/octet-stream',
                data: base64,
            },
        };
    } catch (e) {
        console.error(`Error in convertImageUrlToPart for ${imageUrlBlock.image_url.original_name} (${imageUrlBlock.image_url.url}):`, e);
        return { text: `[⚠ could not fetch image: ${imageUrlBlock.image_url.original_name}]` };
    }
}

let _cachedUser = null
export async function getCurrentUser({ forceRefresh = false } = {}) {
  if (_cachedUser && !forceRefresh) return _cachedUser
  const { data:{ session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.user) throw new Error('Not authenticated')
  _cachedUser = session.user
  return _cachedUser
}

export async function callApiForText({
  messages = [],
  apiKey   = '',
  signal
} = {}) {
  let validatedKey;
  try {
    validatedKey = validateKey(apiKey);
  } catch (err) {
    throw err; 
  }
  if (signal?.aborted) {
    const abortError = new Error('Request aborted by caller');
    abortError.name = 'AbortError';
    throw abortError; 
  }
  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: validatedKey });
  } catch (err) {
    throw new Error('@google/genai SDK initialisation failed: ' + err.message); 
  }
  let systemInstructionText = "";
  const historyContents = [];
  for (const msg of messages) {
    const parts = [];
    const contentBlocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];
    for (const block of contentBlocks) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'image_url' && block.image_url && block.image_url.url) {
        parts.push(await convertImageUrlToPart(block));
      } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type) {
        parts.push({
          fileData: {
            mimeType: block.file.mime_type,
            fileUri: block.file.file_id,
          },
        });
      }
    }
    if (parts.length > 0) {
      if (msg.role === 'system') {
        const systemTextPart = parts.find(p => p.text);
        if (systemTextPart) systemInstructionText += (systemInstructionText ? "\n" : "") + systemTextPart.text;
      } else {
        historyContents.push({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: parts,
        });
      }
    }
  }
  if (historyContents.length === 0 && !systemInstructionText) {
    throw new Error("No content to send to the model."); 
  }
  const requestPayload = {
    model: GEMINI_MODEL_NAME,
    contents: historyContents,
    config: {
      temperature: 1.0,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
      ...(systemInstructionText && { systemInstruction: systemInstructionText }),
    },
  };
  if (requestPayload.contents.length === 0 && !requestPayload.config.systemInstruction) {
      throw new Error("No contents or system instruction to send to API."); 
  }
  let timeoutId;
  const controller = new AbortController(); 
  if(signal) {
    signal.addEventListener('abort', () => controller.abort());
  }
  try {
    const generatePromise = ai.models.generateContent(requestPayload, { signal: controller.signal });
    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        controller.abort(); 
        rej(new Error('Request timed out'));
      }, OPENAI_TIMEOUT_MS);
    });
    const response = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutId);
    let textContent = "";
    if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.finishReason === "SAFETY" || (candidate.safetyRatings && candidate.safetyRatings.some(r => r.blocked))) {
            throw new Error(`Content generation stopped due to safety reasons. Finish reason: ${candidate.finishReason}.`);
        }
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            for (const part of candidate.content.parts) {
                if (part.text) {
                    textContent += part.text;
                }
            }
        }
    } else if (response && typeof response.text === 'string') { 
        textContent = response.text;
    }
    if (textContent) {
      return { content: textContent }; 
    } else {
      throw new Error('No text content generated by the model.'); 
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError' && signal?.aborted) throw err; 
    if (err.name === 'AbortError' && !signal?.aborted) throw new Error('Request timed out'); 
    throw err; 
  }
}


export async function fetchChats({ pageParam = 1 }) {
    // ... (fetchChats - unchanged) ...
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

export async function createChat({ title = 'New Chat', model = GEMINI_MODEL_NAME }) {
    // ... (createChat - unchanged) ...
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
    // ... (updateChatTitle - unchanged) ...
  const user = await getCurrentUser(); 
  const { error } = await supabase
    .from('chats')
    .update({ title: newTitle })
    .eq('id', id)
    .eq('user_id', user.id); 
  if (error) throw error;
  return { success: true, id, title: newTitle };
}

export async function deleteChat(id) {
    // ... (deleteChat - unchanged) ...
  const user = await getCurrentUser(); 
  const { error } = await supabase
    .from('chats')
    .update({ deleted_at: isoNow() })
    .eq('id', id)
    .eq('user_id', user.id); 
  if (error) throw error;
  return { success: true, id };
}

export async function fetchMessages(chat_id) {
    // ... (fetchMessages - unchanged) ...
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
    // ... (createMessage - unchanged) ...
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMessage(id, newContentArray) {
    // ... (updateMessage - unchanged) ...
  const { data, error } = await supabase
    .from('messages')
    .update({ content: newContentArray })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function archiveMessagesAfter(chat_id, anchorCreatedAt) {
    // ... (archiveMessagesAfter - unchanged) ...
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt);
  if (error) throw error;
  return { success: true };
}

export async function deleteMessage(id) {
    // ... (deleteMessage - unchanged, already soft deletes) ...
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() }) 
    .eq('id', id);
  if (error) throw error;
  return { success: true, id }; 
}

/**
 * Reverts a soft delete on a message.
 * @param {string} id - The ID of the message to undelete.
 * @returns {Promise<{success: boolean, id: string}>}
 */
export async function undoDeleteMessage(id) {
  // For simplicity, we're just clearing deleted_at.
  // A more robust undo might check if it was deleted within a certain timeframe.
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) throw error;
  return { success: true, id };
}
