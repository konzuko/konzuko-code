/* ======================================================================
   File: src/api.js   –  MIGRATED FOR NEW @google/genai SDK
====================================================================== */

console.log('API.JS FILE LOADED (for @google/genai) - VERSION MIGRATE_001 - TIMESTAMP', new Date().toISOString());

import { supabase }                      from './lib/supabase.js'
import { OPENAI_TIMEOUT_MS }             from './config.js'
import {
    GoogleGenAI,
    HarmCategory, // Assuming HarmCategory and HarmBlockThreshold are exported or have equivalents
    HarmBlockThreshold,
    // For the new SDK, parts creation might need specific helpers if not direct objects
    // e.g., createUserContent, createPartFromUri from your example, but these are not standard SDK exports
    // We will try to construct parts directly first.
} from "@google/genai"; // This should now be @google/genai

console.log('Imported GoogleGenAI object from @google/genai:', GoogleGenAI);

/* ───────────────────── configuration ───────────────────── */
// The "After" examples use models like "gemini-2.0-flash".
// You might need to adjust this if "gemini-2.5-pro-preview-05-06" isn't recognized by the new SDK
// or if it expects a different alias (e.g., without "models/").
// Let's try with the full path first, then without "models/" if it fails.
export const GEMINI_MODEL_NAME = "gemini-2.5-pro-preview-05-06"; // Or just "gemini-2.5-pro-preview-05-06"
// export const GEMINI_MODEL_NAME = "gemini-1.5-pro-latest"; // A common, generally available model

/* ───────────────────── helpers ─────────────────────────── */
const isoNow = () => new Date().toISOString()

function validateKey(raw = '') {
  console.log('[validateKey] Received raw key for validation, length:', raw ? raw.length : 'undefined/null');
  const key = raw ? raw.trim() : '';
  console.log('[validateKey] Trimmed key, length:', key.length);

  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    const errorMsg = 'Gemini API key missing or malformed.\n' +
    'It should be 30-60 characters. Copy from Google AI Studio or Google Cloud.';
    console.error('[validateKey] Validation failed:', errorMsg, 'Tested key:', key);
    throw new Error(errorMsg);
  }
  console.log('[validateKey] Validation passed for key snippet:', key.substring(0, 5) + '...');
  return key;
}

// This helper converts your existing image_url structure to what the new SDK might expect for inline data.
// The new SDK's "After" examples for images show `ai.files.upload` and then using the URI.
// For a first pass, we'll try to adapt your existing base64 approach.
// If this doesn't work, we'll need to implement the ai.files.upload flow for images too.
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
                mimeType: blob.type || 'application/octet-stream', // Or derive from original_name
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

/* ───────────────────── main RPC helper ─────────────────── */
export async function callApiForText({
  messages = [], // OpenAI-style messages: [{role, content: string | array_of_parts}]
  apiKey   = '',
  // model prop is not directly used by ai.models.generateContent, model name is in payload
  signal
} = {}) {
  console.log('[callApiForText @google/genai] Initiated. Received apiKey prop length:', apiKey ? apiKey.length : 'undefined/null');

  let validatedKey;
  try {
    validatedKey = validateKey(apiKey);
  } catch (err) {
    console.error('[callApiForText @google/genai] Error during key validation:', err.message);
    return { error: err.message, status: 400 };
  }

  if (signal?.aborted) {
    console.log('[callApiForText @google/genai] Request aborted by caller before SDK init.');
    return { error: 'Request aborted by caller' };
  }

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: validatedKey });
    console.log('[callApiForText @google/genai] GoogleGenAI SDK constructed successfully.');
  } catch (err) {
    console.error('[callApiForText @google/genai] Error during GoogleGenAI constructor:', err);
    return { error: '@google/genai SDK initialisation failed: ' + err.message, status: 500 };
  }

  // The new SDK structure for messages (contents) is different.
  // It expects a direct string for simple prompts, or an array of "Content" objects
  // A "Content" object has `role` and `parts`. `parts` is an array of `Part` objects.
  // `Part` can be {text: "..."} or {inlineData: {mimeType:"...", data:"..."}} or {fileData: {mimeType:"...", fileUri:"..."}}

  let systemInstructionText = "";
  const historyContents = []; // This will be an array of Content objects for history

  for (const msg of messages) {
    const parts = [];
    // msg.content can be a string (older format) or an array of blocks (your newer format)
    const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        parts.push({ text: block.text });
      } else if (block.type === 'image_url') {
        parts.push(await convertImageUrlToPart(block)); // convertImageUrlToPart now returns a Part-like object
      } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type) {
        // This matches the new SDK's fileData structure
        parts.push({
          fileData: {
            mimeType: block.file.mime_type,
            fileUri: block.file.file_id, // This should be the Gemini File API URI (e.g., "files/...")
          },
        });
      }
    }

    if (parts.length > 0) {
      if (msg.role === 'system') {
        // The new SDK might not have a direct 'system' role for generateContent history.
        // Often, system instructions are prepended to the first user message or handled via a `systemInstruction` field in the request.
        // The "After" examples don't explicitly show multi-turn chat history with a system role for generateContent.
        // For chat, it's `ai.chats.create({ systemInstruction: "..." })`.
        // Let's try to extract it and pass it to `config.systemInstruction` if available,
        // or prepend to the next user message if not.
        // The `generateContent` "After" example doesn't show a system instruction field.
        // We'll collect it and decide later. For now, let's assume the last message is the current prompt.
        const systemTextPart = parts.find(p => p.text);
        if (systemTextPart) systemInstructionText += (systemInstructionText ? "\n" : "") + systemTextPart.text;
      } else {
        historyContents.push({
          role: msg.role === 'assistant' ? 'model' : msg.role, // 'model' or 'user'
          parts: parts,
        });
      }
    }
  }

  // The `contents` for `ai.models.generateContent` is typically the *current* user prompt.
  // If `historyContents` has multiple turns, the new SDK's `generateContent` might not directly support
  // passing full chat history in the same way the old `getGenerativeModel().generateContent(messages)` did.
  // The "After" example for `generateContent` shows `contents: "Your prompt string"` or `contents: [array_of_parts_for_current_prompt]`.
  // For chat, you'd use `ai.chats.create()` and `chat.sendMessage()`.
  //
  // Let's assume the LAST message in `messages` is the current prompt to the model.
  // And the preceding messages are history.
  // The new `generateContent` doesn't seem to have a `history` field like `startChat`.
  // This is a key difference. If you need multi-turn context, `ai.chats` is the way.
  // For a single `generateContent` call, we might need to concatenate history into the prompt,
  // or only send the last user message.
  //
  // For now, let's try sending ALL `historyContents` as the `contents` payload.
  // The SDK might interpret the roles correctly for multi-turn.
  // If not, we'll need to adjust to send only the last user message + parts.

  if (historyContents.length === 0 && !systemInstructionText) {
    console.error("[callApiForText @google/genai] No valid contents to send.");
    return { error: "No content to send to the model.", status: 400 };
  }

  // Construct the payload for ai.models.generateContent
  // The `contents` field should be the actual prompt data.
  // If there's a system instruction, some models/versions of the new SDK might take it in `config`.
  // The "After" examples for `generateContent` don't show `systemInstruction` in `config`.
  // The `ai.caches.create` example *does* show `config: { systemInstruction: "..." }`.
  // This is an area that might need adjustment based on runtime behavior.

  const requestPayload = {
    model: GEMINI_MODEL_NAME, // e.g., "gemini-2.0-flash" or your "gemini-2.5-pro-preview-05-06"
    // contents: historyContents, // Send the whole history
    // Let's try sending only the last content as the prompt, and if systemInstructionText exists, prepend it.
    // This is more aligned with single-shot generateContent.
    // If you need full chat history, the `ai.chats` API is better.
    contents: [],
    config: {
      // candidateCount: 1, // Default is 1
      // maxOutputTokens: 8192, // Example
      temperature: 1.0, // Default is often 0.9 or 1.0
      topP: 0.95,       // Default
      // topK: 40,         // Default varies
      safetySettings: [ // Structure from "After" example
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }, // Example values
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
      // systemInstruction: systemInstructionText || undefined, // Try passing system instruction here
    },
  };

  // Prepare the final `contents` for the request
  let finalUserParts = [];
  if (historyContents.length > 0) {
    const lastMessage = historyContents[historyContents.length - 1];
    if (lastMessage.role === 'user') {
        finalUserParts = [...lastMessage.parts];
    } else {
        // If the last message isn't from the user, this is an unusual state for a new prompt
        console.warn("[callApiForText @google/genai] Last message in history is not from user. Sending empty prompt.");
    }
  }

  if (systemInstructionText) {
    // Prepend system instruction as a text part to the user's actual prompt parts
    finalUserParts.unshift({ text: systemInstructionText });
  }

  if (finalUserParts.length > 0) {
    requestPayload.contents = [{ role: "user", parts: finalUserParts }];
  } else {
    console.error("[callApiForText @google/genai] No final user parts to send after processing system instruction.");
    return { error: "No user content to send to the model.", status: 400 };
  }
  
  // If you need to pass the *entire* chat history (excluding the system message we extracted):
  // requestPayload.contents = historyContents.filter(c => c.role !== 'system'); // This sends an array of Content objects
  // And then you'd need to handle how `systemInstructionText` is passed, perhaps in `requestPayload.config.systemInstruction`.
  // The `ai.models.generateContent` is more for single prompts or prompts with some leading context.
  // For true multi-turn chat, `ai.chats.create` and `chat.sendMessage` is the pattern.
  //
  // Given your app structure, you are essentially sending the whole history as context for the next turn.
  // Let's try sending the full `historyContents` (which now excludes system messages)
  // and see if the new SDK's `generateContent` handles it.
  // The `contents` field for `generateContent` in the new SDK expects `Contents`.
  // `Contents` is `Content[]` where `Content` is `{ role: string, parts: Part[] }`.
  // So, `historyContents` should be the correct structure.

  requestPayload.contents = historyContents; // This should be an array of {role, parts} objects.

  if (requestPayload.contents.length === 0) {
      console.error("[callApiForText @google/genai] `contents` array is empty before API call.");
      return { error: "No contents to send to API.", status: 400 };
  }


  let timeoutId;
  try {
    console.log('[callApiForText @google/genai] Calling ai.models.generateContent with model:', requestPayload.model);
    console.log('[callApiForText @google/genai] Payload:', JSON.stringify(requestPayload, null, 2).substring(0, 500) + "...");

    const generatePromise = ai.models.generateContent(requestPayload);

    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => rej(new Error('Request timed out')), OPENAI_TIMEOUT_MS);
    });

    const abortPromise = signal
      ? new Promise((_, rej) =>
          signal.addEventListener('abort', () => rej(new Error('Aborted by caller')), { once: true })
        )
      : null;

    const response = await Promise.race([generatePromise, timeoutPromise, abortPromise].filter(Boolean));
    clearTimeout(timeoutId);
    console.log('[callApiForText @google/genai] ai.models.generateContent resolved.');

    // The "After" examples show `response.text` directly for simple cases,
    // and `response.candidates[0].content.parts` for more complex ones (like code execution).
    // Let's try to get text robustly.

    let textContent = "";
    if (response && response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            for (const part of candidate.content.parts) {
                if (part.text) {
                    textContent += part.text;
                }
            }
        }
        // Check for safety ratings and block reasons
        if (candidate.finishReason === "SAFETY" || (candidate.safetyRatings && candidate.safetyRatings.some(r => r.blocked))) {
            console.warn('[callApiForText @google/genai] Content potentially blocked due to safety settings. Candidate:', candidate);
            return {
                error: `Content generation stopped due to safety reasons. Finish reason: ${candidate.finishReason}.`,
                details: JSON.stringify(candidate.safetyRatings || 'No safety ratings provided.'),
                status: 400
            };
        }
    } else if (response && typeof response.text === 'string') { // Fallback for simpler response structure
        textContent = response.text;
    }


    if (textContent) {
      console.log('[callApiForText @google/genai] Successfully generated content snippet:', textContent.substring(0, 100) + '...');
      return { content: textContent };
    } else {
      console.warn('[callApiForText @google/genai] No text content found in response. Full response:', response);
      return { error: 'No text content generated by the model.', status: 500, details: JSON.stringify(response) };
    }

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[callApiForText @google/genai] Error during ai.models.generateContent or subsequent processing:', err);

    if (err.message?.includes('API key not valid')) {
      return { error: 'Invalid Gemini API key. Please check the key in settings.', status: 400 };
    }
    if (
      (err.status === 404 || err.message?.toUpperCase().includes('NOT_FOUND') || err.message?.includes('is not found')) ||
      (err.message?.includes("Could not find model")) // New SDK error message for missing model
    ) {
      return {
        error: `Model "${requestPayload.model}" not found or method not enabled. Check model name.`,
        status: 404
      };
    }
    if (err.message?.includes("failed to connect")) {
        return { error: "Network error: Failed to connect to Google API.", status: 503 };
    }
    // Default error
    return { error: err.message || 'An unknown error occurred with the Gemini API.', details: err.stack, status: err.status || 500 };
  }
}

/* ───────────────────── Chats / Messages CRUD ─────────────────── */
// These CRUD functions remain the same as they interact with Supabase, not the Gemini SDK directly.
// The `model` field in `createChat` now uses `GEMINI_MODEL_NAME`.

export async function fetchChats() {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats').select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createChat({ title = 'New Chat', model = GEMINI_MODEL_NAME }) { // Use new constant
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title, code_type: model }) // model here is just a string for your DB
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

export async function updateMessage(id, newContentArray) {
  const { data, error } = await supabase
    .from('messages')
    .update({ content: newContentArray })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function archiveMessagesAfter(chat_id, anchorCreatedAt) {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: isoNow() })
    .eq('chat_id', chat_id)
    .gt('created_at', anchorCreatedAt)
  if (error) throw error
  return { success: true }
}

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