// file: src/api/geminiApi.js
import { supabase } from '../lib/supabase.js';
import { GEMINI_API_TIMEOUT_MS, GEMINI_MODEL_NAME } from '../config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from "@google/genai";
import { updateMessage } from './supabaseApi.js';

function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    const errorMsg = 'Gemini API key missing or malformed.\n' +
    'It should be 30-60 characters. Copy from Google AI Studio or Google Cloud.';
    throw new Error(errorMsg);
  }
  return key;
}

async function getSignedUrl(path) {
    if (!path) return null;
    const { data, error } = await supabase.functions.invoke('get-signed-urls', {
        body: { paths: [path], expiresIn: 900 }, // 15 min
    });
    if (error || data.error) throw new Error(`getSignedUrl failed: ${error?.message || data.error}`);
    return data.urlMap?.[path] || null;
}

async function uploadAndGetFileId(apiKey, messageId, blockIndex, imageUrlBlock) {
    const path = imageUrlBlock.image_url?.path;
    if (!path) throw new Error('Missing path in imageUrlBlock for upload');

    const signedUrl = await getSignedUrl(path);
    if (!signedUrl) throw new Error(`Could not get signed URL for ${path}`);

    const genAI = new GoogleGenAI({ apiKey });
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Fetch failed for ${path} with status ${res.status}`);
    const blob = await res.blob();

    const uploadedFileResponse = await genAI.files.upload({
        file: blob,
        config: { mimeType: blob.type || 'image/webp', displayName: imageUrlBlock.image_url.original_name || 'uploaded_image.webp' }
    });

    const fileId = uploadedFileResponse?.name;
    if (!fileId) throw new Error('Gemini file upload did not return a file name.');

    // Cache the file_id back to the message in Supabase
    const { data: originalMessage, error } = await supabase.from('messages').select('content').eq('id', messageId).single();
    if (error || !originalMessage) throw new Error(`Could not fetch original message ${messageId} to cache file_id.`);

    const updatedContent = [...originalMessage.content];
    updatedContent[blockIndex] = { ...imageUrlBlock, image_url: { ...imageUrlBlock.image_url, file_id: fileId } };
    await updateMessage(messageId, updatedContent);

    return fileId;
}

export async function callApiForText({
  messages = [],
  apiKey   = '',
  signal,
} = {}) {
  const callTimestamp = new Date().toISOString();
  console.log(`[API @ ${callTimestamp}] Initiating call.`);

  const validatedKey = validateKey(apiKey);
  if (signal?.aborted) throw new Error('Request aborted before API call');

  const ai = new GoogleGenAI({ apiKey: validatedKey });

  let systemInstructionText = "";
  const historyContents = [];

  for (const msg of messages) {
    const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
    const parts = [];

    for (const [blockIndex, block] of contentBlocks.entries()) {
        if (block.type === 'text') {
            parts.push({ text: block.text });
        } else if (block.type === 'image_url' && block.image_url) {
            let fileId = block.image_url.file_id;
            if (!fileId) {
                try {
                    fileId = await uploadAndGetFileId(validatedKey, msg.id, blockIndex, block);
                } catch (uploadError) {
                    console.error(`[API] Failed to upload/process image for message ${msg.id}:`, uploadError);
                    parts.push({ text: `[System: Image '${block.image_url.original_name}' failed to load]` });
                    continue;
                }
            }
            let fileUri = fileId.startsWith('files/') ? fileId : `files/${fileId}`;
            parts.push({ fileData: { mimeType: block.image_url.mime_type || 'image/webp', fileUri } });

        } else if (block.type === 'file' && block.file?.file_id) {
            let fileUri = block.file.file_id;
            if (!fileUri.startsWith('files/')) fileUri = `files/${fileUri}`;
            parts.push({ fileData: { mimeType: block.file.mime_type, fileUri } });
        }
    }

    if (parts.length > 0) {
      if (msg.role === 'system') {
        const systemTextPart = parts.find(p => p.text);
        if (systemTextPart) systemInstructionText += (systemInstructionText ? "\n" : "") + systemTextPart.text;
      } else {
        historyContents.push({ role: msg.role === 'assistant' ? 'model' : msg.role, parts });
      }
    }
  }

  let finalSystemInstruction = HARDCODED_GEMINI_SYSTEM_PROMPT;
  if (systemInstructionText.trim()) {
    finalSystemInstruction += "\n\n" + systemInstructionText.trim();
  }

  const requestPayload = {
    model: GEMINI_MODEL_NAME,
    contents: historyContents,
    config: {
      temperature: 0.0,
      topP: 0.95,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    },
    ...(finalSystemInstruction && { systemInstruction: finalSystemInstruction }),
  };

  let timeoutId;
  const attemptApiCall = async (payload) => {
    const controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => controller.abort());

    const generatePromise = ai.models.generateContent(payload, { signal: controller.signal });
    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        rej(new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`));
      }, GEMINI_API_TIMEOUT_MS);
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutId);
    return response;
  };

  try {
    let response = await attemptApiCall(requestPayload);

    if (response?.usageMetadata) {
      const { cachedContentTokenCount, totalTokenCount } = response.usageMetadata;
      if (cachedContentTokenCount > 0) console.log(`%c[Gemini Cache] IMPLICIT HIT. Cached: ${cachedContentTokenCount}, Total: ${totalTokenCount}`, 'color: #4caf50; font-weight: bold;');
    }

    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") throw new Error('Content generation stopped due to safety reasons.');
    
    const textContent = candidate?.content?.parts?.map(p => p.text).join('') ?? '';
    if (textContent) return { content: textContent };
    
    throw new Error(`No text content generated. Finish reason: ${candidate?.finishReason || 'N/A'}.`);

  } catch (err) {
    clearTimeout(timeoutId);
    // Retry logic for expired file IDs
    if (err.message?.includes('INVALID_ARGUMENT') && err.message?.includes('File not found')) {
        console.warn('[API] Detected potential expired file ID. Forcing re-upload of all images...');
        // Re-build the payload, but force re-upload by removing file_id from image blocks
        const retryHistoryContents = [];
        for (const msg of messages) {
            const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
            const parts = [];
            for (const [blockIndex, block] of contentBlocks.entries()) {
                if (block.type === 'image_url' && block.image_url) {
                    const { file_id, ...restOfImageUrl } = block.image_url; // strip file_id
                    const newBlock = { ...block, image_url: restOfImageUrl };
                    const newFileId = await uploadAndGetFileId(validatedKey, msg.id, blockIndex, newBlock);
                    let fileUri = newFileId.startsWith('files/') ? newFileId : `files/${newFileId}`;
                    parts.push({ fileData: { mimeType: block.image_url.mime_type || 'image/webp', fileUri } });
                } else {
                    // Non-image blocks are added as-is
                    const originalPart = requestPayload.contents.find(c => c.role === (msg.role === 'assistant' ? 'model' : msg.role))?.parts[blockIndex];
                    if (originalPart) parts.push(originalPart);
                }
            }
            if (parts.length > 0) {
                retryHistoryContents.push({ role: msg.role === 'assistant' ? 'model' : msg.role, parts });
            }
        }
        const retryPayload = { ...requestPayload, contents: retryHistoryContents };
        const retryResponse = await attemptApiCall(retryPayload);
        const retryCandidate = retryResponse?.candidates?.[0];
        const retryTextContent = retryCandidate?.content?.parts?.map(p => p.text).join('') ?? '';
        if (retryTextContent) return { content: retryTextContent };
        throw new Error(`Retry failed. No text content. Finish reason: ${retryCandidate?.finishReason || 'N/A'}.`);
    }

    if (err.name === 'AbortError' && !signal?.aborted) {
        throw new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}
