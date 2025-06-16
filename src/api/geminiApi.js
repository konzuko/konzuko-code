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

async function getSignedUrlsForPaths(paths) {
  if (paths.size === 0) return {};
  const { data, error } = await supabase.functions.invoke('get-signed-urls', {
    body: { paths: Array.from(paths), expiresIn: 900 }
  });
  if (error || data.error) {
    throw new Error(`Failed to get signed URLs for API call: ${error?.message || data.error}`);
  }
  return data.urlMap || {};
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
                mimeType: blob.type || 'image/webp',
                data: base64,
            },
        };
    } catch (e) {
        console.error(`[API - convertImageUrlToPart] Error for ${imageUrlBlock.image_url.original_name}:`, e);
        return { text: `[⚠ could not fetch image: ${imageUrlBlock.image_url.original_name}]` };
    }
}

async function buildApiPartsForMessage(msg, ai, urlMap, forceBase64 = false) {
    const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
    const parts = [];

    for (const block of contentBlocks) {
        if (block.type === 'text') {
            parts.push({ text: block.text });
        } else if (block.type === 'file' && block.file?.file_id) {
            // --- BUG FIX: Handle legacy URI format and use correct fileId ---
            let fileUri = block.file.file_id;

            // Backward-compatibility: if we previously stored the public `uri`,
            // convert it to the internal `name` format (e.g., "files/file-...")
            if (fileUri.startsWith('https://')) {
                const idx = fileUri.indexOf('/files/');
                if (idx !== -1) {
                    fileUri = fileUri.slice(idx + 1); // Keep "files/..."
                }
            }

            parts.push({ 
                fileData: { 
                    mimeType: block.file.mime_type, 
                    fileUri: fileUri 
                } 
            });
            // --- END FIX ---
        } else if (block.type === 'image_url' && block.image_url) {
            const useCachedFile = block.image_url.file_id && !forceBase64;

            if (useCachedFile) {
                parts.push({ fileData: { mimeType: 'image/webp', fileUri: block.image_url.file_id } });
            } else if (block.image_url.path) {
                const signedUrl = urlMap[block.image_url.path];
                if (signedUrl) {
                    const imagePart = await convertImageUrlToPart({ image_url: { ...block.image_url, url: signedUrl } });
                    parts.push(imagePart);

                    if (!block.image_url.file_id) {
                        (async () => {
                            try {
                                const res = await fetch(signedUrl);
                                const blob = await res.blob();
                                const uploadResult = await ai.files.upload({
                                    file: blob,
                                    config: { mimeType: 'image/webp', displayName: block.image_url.original_name }
                                });
                                if (uploadResult?.name) { // Check for 'name'
                                    const newFileId = uploadResult.name; // Use 'name'
                                    const updatedContent = msg.content.map(b =>
                                        b.type === 'image_url' && b.image_url.path === block.image_url.path
                                            ? { ...b, image_url: { ...b.image_url, file_id: newFileId } }
                                            : b
                                    );
                                    await updateMessage(msg.id, updatedContent);
                                    console.log(`[API] Cached image ${block.image_url.original_name} with file_id: ${newFileId}`);
                                }
                            } catch (e) {
                                console.error(`[API] Failed to cache image ${block.image_url.original_name}:`, e);
                            }
                        })();
                    }
                }
            }
        }
    }
    return parts;
}

export async function callApiForText({
  messages = [],
  apiKey   = '',
  signal,
  _retry = false
} = {}) {
  const callTimestamp = new Date().toISOString();
  console.log(`[API @ ${callTimestamp}] Initiating call. Retry: ${_retry}`);

  const validatedKey = validateKey(apiKey);
  if (signal?.aborted) throw new Error('Request aborted before API call');

  const ai = new GoogleGenAI({ apiKey: validatedKey });

  let systemInstructionText = "";
  const historyContents = [];
  const pathsToSign = new Set();

  messages.forEach(msg => {
    const content = Array.isArray(msg.content) ? msg.content : [];
    content.forEach(block => {
      const isUncachedImage = block.type === 'image_url' && block.image_url?.path && !block.image_url.file_id;
      const isRetryImage = _retry && block.type === 'image_url' && block.image_url?.path;
      if (isUncachedImage || isRetryImage) {
        pathsToSign.add(block.image_url.path);
      }
    });
  });

  const urlMap = await getSignedUrlsForPaths(pathsToSign);

  for (const msg of messages) {
    const parts = await buildApiPartsForMessage(msg, ai, urlMap, _retry);
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
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      ],
    },
    ...(finalSystemInstruction && { systemInstruction: finalSystemInstruction }),
  };

  let timeoutId;
  try {
    const controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => controller.abort());
    
    const generatePromise = ai.models.generateContent(requestPayload, { signal: controller.signal });
    const timeoutPromise = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        rej(new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`));
      }, GEMINI_API_TIMEOUT_MS);
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);
    clearTimeout(timeoutId);
    
    const candidate = response?.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") throw new Error('Content generation stopped due to safety reasons.');
    
    const textContent = candidate?.content?.parts?.map(p => p.text).join('') ?? '';
    if (textContent) return { content: textContent };
    
    throw new Error(`No text content generated. Finish reason: ${candidate?.finishReason || 'N/A'}.`);

  } catch (err) {
    clearTimeout(timeoutId);
    
    const isInvalidFileError = err.message?.includes('file not found') || err.message?.includes('permission denied on resource');
    if (isInvalidFileError && !_retry) {
      console.warn(`[API] A cached file_id was invalid. Retrying with Base64 fallback for all images.`);
      return callApiForText({ messages, apiKey, signal, _retry: true });
    }
    
    if (err.name === 'AbortError' && !signal?.aborted) {
        throw new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}
