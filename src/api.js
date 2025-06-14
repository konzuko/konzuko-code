/* src/api.js */
/* ======================================================================
   File: src/api.js
====================================================================== */

import { supabase } from './lib/supabase.js';
import { GEMINI_API_TIMEOUT_MS } from './config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from './system-prompt.md?raw';
import {
    GoogleGenAI,
    // HarmCategory, // Not directly used as string values are used
    // HarmBlockThreshold, // Not directly used as string values are used
} from "@google/genai";

export const GEMINI_MODEL_NAME = "gemini-2.5-pro-preview-06-05";
export const CHATS_PAGE_LIMIT = 20;

const isoNow = () => new Date().toISOString()

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
        console.warn('[API - convertImageUrlToPart] Invalid image_url block:', imageUrlBlock);
        return { text: `[Invalid image_url block]` };
    }
    try {
        const res = await fetch(imageUrlBlock.image_url.url);
        if (!res.ok) {
            console.error(`[API - convertImageUrlToPart] Fetch failed ${res.status} from ${imageUrlBlock.image_url.url}`);
            throw new Error(`Fetch ${res.status} from ${imageUrlBlock.image_url.url}`);
        }
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
        console.error(`[API - convertImageUrlToPart] Error for ${imageUrlBlock.image_url.original_name} (${imageUrlBlock.image_url.url}):`, e);
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
  const callTimestamp = new Date().toISOString();
  console.log(`[API - callApiForText @ ${callTimestamp}] Initiating call.`);

  let validatedKey;
  try {
    validatedKey = validateKey(apiKey);
  } catch (err) {
    console.error(`[API - callApiForText @ ${callTimestamp}] API Key validation failed:`, err.message);
    throw err;
  }

  if (signal?.aborted) {
    const abortError = new Error('Request aborted by caller before API call');
    abortError.name = 'AbortError';
    console.warn(`[API - callApiForText @ ${callTimestamp}] Request aborted by caller (pre-call).`);
    throw abortError;
  }

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: validatedKey });
  } catch (err) {
    console.error(`[API - callApiForText @ ${callTimestamp}] @google/genai SDK initialisation failed:`, err.message, err);
    throw new Error('@google/genai SDK initialisation failed: ' + err.message);
  }

  let systemInstructionTextFromMessages = "";
  const historyContents = [];
  console.log(`[API - callApiForText @ ${callTimestamp}] Processing ${messages.length} input messages.`);

  for (const msg of messages) {
    const contentBlocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    // Separate text/file parts from image parts
    const textAndFileParts = contentBlocks.filter(b => b.type !== 'image_url');
    const imagePartsToProcess = contentBlocks.filter(b => b.type === 'image_url' && b.image_url?.url);

    // Process all images in parallel
    const processedImageParts = await Promise.all(imagePartsToProcess.map(convertImageUrlToPart));

    const parts = [];
    for (const block of textAndFileParts) {
        if (block.type === 'text') {
            parts.push({ text: block.text });
        } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type) {
            parts.push({
              fileData: {
                mimeType: block.file.mime_type,
                fileUri: block.file.file_id,
              },
            });
        }
    }
    
    // Combine the processed parts
    const finalParts = [...parts, ...processedImageParts];

    if (finalParts.length > 0) {
      if (msg.role === 'system') {
        const systemTextPart = finalParts.find(p => p.text);
        if (systemTextPart) systemInstructionTextFromMessages += (systemInstructionTextFromMessages ? "\n" : "") + systemTextPart.text;
      } else {
        historyContents.push({
          role: msg.role === 'assistant' ? 'model' : msg.role,
          parts: finalParts,
        });
      }
    }
  }

  let finalSystemInstruction = HARDCODED_GEMINI_SYSTEM_PROMPT;
  if (systemInstructionTextFromMessages.trim()) {
    finalSystemInstruction += "\n\n" + systemInstructionTextFromMessages.trim();
  }

  if (historyContents.length === 0 && !finalSystemInstruction) {
    console.error(`[API - callApiForText @ ${callTimestamp}] No content (history or system instruction) to send to the model.`);
    throw new Error("No content to send to the model.");
  }

  const requestPayload = {
    model: GEMINI_MODEL_NAME,
    contents: historyContents,
    config: {
      temperature: 0.0,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      ],
      ...(finalSystemInstruction && { systemInstruction: finalSystemInstruction }),
    },
  };

  if (requestPayload.contents.length === 0 && !requestPayload.config.systemInstruction) {
      console.error(`[API - callApiForText @ ${callTimestamp}] Final check: No contents or system instruction to send to API.`);
      throw new Error("No contents or system instruction to send to API.");
  }

  console.log(`[API - callApiForText @ ${callTimestamp}] Sending request to Gemini. Model: ${requestPayload.model}, History items: ${historyContents.length}, System instruction present: ${!!finalSystemInstruction}`);

  let timeoutId;
  const controller = new AbortController();
  if(signal) {
    signal.addEventListener('abort', () => {
        console.warn(`[API - callApiForText @ ${callTimestamp}] External signal aborted. Aborting Gemini request.`);
        controller.abort();
    });
  }

  try {
    const generatePromise = ai.models.generateContent(requestPayload, { signal: controller.signal });
    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        console.warn(`[API - callApiForText @ ${callTimestamp}] Request timed out after ${GEMINI_API_TIMEOUT_MS}ms. Aborting Gemini request.`);
        controller.abort();
        rej(new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`));
      }, GEMINI_API_TIMEOUT_MS);
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutId);

    console.log(`[API - callApiForText @ ${callTimestamp}] Received response from Gemini.`);

    let textContent = "";
    if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        console.log(`[API - callApiForText @ ${callTimestamp}] Candidate finishReason: ${candidate.finishReason}`);
        if (candidate.safetyRatings) {
            console.log(`[API - callApiForText @ ${callTimestamp}] Candidate safetyRatings:`, JSON.stringify(candidate.safetyRatings));
        }

        if (candidate.finishReason === "SAFETY" || (candidate.safetyRatings && candidate.safetyRatings.some(r => r.blocked))) {
            let safetyMessage = `Content generation stopped due to safety reasons. Finish reason: ${candidate.finishReason}.`;
            if (candidate.safetyRatings) {
                const blockedCategories = candidate.safetyRatings.filter(r => r.blocked).map(r => r.category).join(', ');
                if (blockedCategories) {
                    safetyMessage += ` Blocked categories: ${blockedCategories}.`;
                }
            }
            console.error(`[API - callApiForText @ ${callTimestamp}] Safety block: ${safetyMessage}`);
            throw new Error(safetyMessage);
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
      console.log(`[API - callApiForText @ ${callTimestamp}] Extracted text content successfully. Length: ${textContent.length}`);
      return { content: textContent };
    } else {
      const finishReason = response?.candidates?.[0]?.finishReason;
      const errMessage = `No text content generated by the model. Finish reason: ${finishReason || 'N/A'}. Full response logged above.`;
      console.warn(`[API - callApiForText @ ${callTimestamp}] ${errMessage}`);
      throw new Error(errMessage);
    }

  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[API - callApiForText @ ${callTimestamp}] Error during Gemini call or processing:`, err.message, err.name, err.stack, err);

    if (err.name === 'AbortError' && signal?.aborted) {
        console.warn(`[API - callApiForText @ ${callTimestamp}] Confirmed AbortError due to external signal.`);
        throw err;
    }
    if (err.name === 'AbortError' && !signal?.aborted) {
        console.warn(`[API - callApiForText @ ${callTimestamp}] Confirmed AbortError due to timeout.`);
        throw new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
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

// NEW: Single function to call the atomic 'undo-fork' edge function
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
