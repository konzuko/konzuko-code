// file: src/api/geminiApi.js
import { supabase } from '../lib/supabase.js';
import { GEMINI_API_TIMEOUT_MS, GEMINI_MODEL_NAME } from '../config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from "@google/genai";
// We no longer need updateMessage here as we aren't caching file_ids
// import { updateMessage } from './supabaseApi.js';

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
    body: { paths: Array.from(paths), expiresIn: 900 } // 15 minutes
  });
  if (error || data.error) {
    throw new Error(`Failed to get signed URLs for API call: ${error?.message || data.error}`);
  }
  return data.urlMap || {};
}

async function convertImageUrlToPart(imageUrlBlock, urlMap) {
    const path = imageUrlBlock.image_url?.path;
    if (!path) return { text: `[Invalid image_url block: no path]` };

    const signedUrl = urlMap[path];
    if (!signedUrl) return { text: `[Could not get URL for image: ${imageUrlBlock.image_url.original_name}]` };

    try {
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`Fetch ${res.status} from signed URL for ${path}`);
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
        console.error(`[API - convertImageUrlToPart] Error for ${path}:`, e);
        return { text: `[⚠ could not fetch image: ${imageUrlBlock.image_url.original_name}]` };
    }
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

  // --- SIMPLIFIED LOGIC: Always use permanent storage ---
  // 1. Collect all unique image paths from the entire conversation history.
  const pathsToSign = new Set();
  messages.forEach(msg => {
    const content = Array.isArray(msg.content) ? msg.content : [];
    content.forEach(block => {
        if (block.type === 'image_url' && block.image_url?.path) {
            pathsToSign.add(block.image_url.path);
        }
    });
  });

  // 2. Get fresh signed URLs for all of them.
  const urlMap = await getSignedUrlsForPaths(pathsToSign);

  // 3. Build the API payload, converting every image to Base64.
  let systemInstructionText = "";
  const historyContents = [];

  for (const msg of messages) {
    const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
    const parts = [];

    for (const block of contentBlocks) {
        if (block.type === 'text') {
            parts.push({ text: block.text });
        } else if (block.type === 'image_url' && block.image_url) {
            const imagePart = await convertImageUrlToPart(block, urlMap);
            parts.push(imagePart);
        } else if (block.type === 'file' && block.file?.file_id) {
            // PDF/File logic remains the same, as it relies on the Gemini Files API
            let fileUri = block.file.file_id;
            if (fileUri.startsWith('https://')) {
                const idx = fileUri.indexOf('/files/');
                if (idx !== -1) fileUri = fileUri.slice(idx + 1);
            }
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
  // --- END SIMPLIFIED LOGIC ---

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
    
    // Retry logic is no longer needed as we don't depend on expiring file_ids for images.
    
    if (err.name === 'AbortError' && !signal?.aborted) {
        throw new Error(`Request timed out after ${GEMINI_API_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}
