/* ======================================================================
   File: src/api.js   –  MODIFIED FOR TanStack Query & Pagination
====================================================================== */

console.log('API.JS FILE LOADED (for @google/genai & TanStack Query) - VERSION TQ_001 - TIMESTAMP', new Date().toISOString());

import { supabase }                      from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS }             from './config.js'
import {
    GoogleGenAI,
    HarmCategory,
    HarmBlockThreshold,
} from "@google/genai";

export const GEMINI_MODEL_NAME = "gemini-2.5-pro-preview-05-06";
export const CHATS_PAGE_LIMIT = 20; // Number of chats to fetch per page

/* ───────────────────── helpers ─────────────────────────── */
const isoNow = () => new Date().toISOString()

function validateKey(raw = '') {
  // ... (validateKey function remains the same)
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    const errorMsg = 'Gemini API key missing or malformed.\n' +
    'It should be 30-60 characters. Copy from Google AI Studio or Google Cloud.';
    throw new Error(errorMsg);
  }
  return key;
}

async function convertImageUrlToPart(imageUrlBlock) {
    // ... (convertImageUrlToPart function remains the same)
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

/* ───────────────────── Supabase auth ───────────────────── */
let _cachedUser = null
export async function getCurrentUser({ forceRefresh = false } = {}) {
  // ... (Supabase auth remains the same)
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
  // ... (callApiForText function remains largely the same, ensure it throws errors for TQ to catch)
  console.log('[callApiForText @google/genai] Initiated. Received apiKey prop length:', apiKey ? apiKey.length : 'undefined/null');

  let validatedKey;
  try {
    validatedKey = validateKey(apiKey);
  } catch (err) {
    console.error('[callApiForText @google/genai] Error during key validation:', err.message);
    throw err; // Throw error for TQ
  }

  if (signal?.aborted) {
    console.log('[callApiForText @google/genai] Request aborted by caller before SDK init.');
    const abortError = new Error('Request aborted by caller');
    abortError.name = 'AbortError';
    throw abortError; // Throw error for TQ
  }

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: validatedKey });
  } catch (err) {
    console.error('[callApiForText @google/genai] Error during GoogleGenAI constructor:', err);
    throw new Error('@google/genai SDK initialisation failed: ' + err.message); // Throw
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
    throw new Error("No content to send to the model."); // Throw
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
      throw new Error("No contents or system instruction to send to API."); // Throw
  }

  let timeoutId;
  const controller = new AbortController(); // For timeout
  if(signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const generatePromise = ai.models.generateContent(requestPayload, { signal: controller.signal });

    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        controller.abort(); // Abort the fetch
        rej(new Error('Request timed out'));
      }, OPENAI_TIMEOUT_MS);
    });
    
    const response = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutId);

    let textContent = "";
    if (response && response.candidates && response.candidates.length > 0) {
        // ... (safety check logic - if blocked, throw an error)
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
    } else if (response && typeof response.text === 'string') { // Older SDK might return this
        textContent = response.text;
    }


    if (textContent) {
      return { content: textContent }; // Return data for TQ
    } else {
      throw new Error('No text content generated by the model.'); // Throw
    }

  } catch (err) {
    clearTimeout(timeoutId);
    // Let TQ handle the error object, just rethrow or throw a new one
    if (err.name === 'AbortError' && signal?.aborted) throw err; // If aborted by caller signal
    if (err.name === 'AbortError' && !signal?.aborted) throw new Error('Request timed out'); // If aborted by timeout
    throw err; // Rethrow other errors
  }
}


/* ───────────────────── Chats / Messages CRUD ─────────────────── */

export async function fetchChats({ pageParam = 1 }) {
  const user = await getCurrentUser();
  const limit = CHATS_PAGE_LIMIT;
  const offset = (pageParam - 1) * limit;

  console.log(`[api] fetchChats called with pageParam: ${pageParam}`);

  const { data, error, count } = await supabase
    .from('chats').select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[api] fetchChats error:", error);
    throw error;
  }

  const hasMore = (pageParam * limit) < count;
  console.log(`[api] fetchChats results - count: ${count}, fetched: ${data.length}, hasMore: ${hasMore}, nextPage: ${hasMore ? pageParam + 1 : undefined}`);

  return {
    chats: data || [], // Ensure chats is an array
    nextCursor: hasMore ? pageParam + 1 : undefined,
    totalCount: count || 0,
    currentPage: pageParam
  };
}

export async function createChat({ title = 'New Chat', model = GEMINI_MODEL_NAME }) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model })
    .select()
    .single();
  if (error) throw error;
  return data; // Return the created chat object
}

export async function updateChatTitle(id, newTitle) {
  const { error } = await supabase
    .from('chats')
    .update({ title: newTitle })
    .eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function deleteChat(id) {
  const { error } = await supabase
    .from('chats')
    .update({ deleted_at: isoNow() })
    .eq('id', id);
  if (error) throw error;
  return { success: true, id }; // Return id for cache updates
}

// ... (undoDeleteChat - may need adjustment if used with TQ mutations)

export async function fetchMessages(chat_id) {
  if (!chat_id) return []; // TQ might call with null chat_id if `enabled` isn't strict
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

// ... (updateMessage, archiveMessagesAfter, etc. remain similar, ensure they throw errors)
export async function updateMessage(id, newContentArray) {
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
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt);
  if (error) throw error;
  return { success: true };
}

export async function undoArchiveMessagesAfter(chat_id, anchorCreatedAt) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt);
  if (error) throw error;
  return { success: true };
}

export async function deleteMessage(id) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function undoDeleteMessage(id) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: null })
    .eq('id', id)
    .gt('deleted_at', cutoff);
  if (error) throw error;
  return { success: true };
}
