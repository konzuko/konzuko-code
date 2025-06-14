/* src/api/geminiApi.js */
import { supabase } from '../lib/supabase.js';
import { GEMINI_API_TIMEOUT_MS, GEMINI_MODEL_NAME } from '../config.js'; // <-- IMPORT from config
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from "@google/genai";

// ... rest of the file is unchanged
function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    const errorMsg = 'Gemini API key missing or malformed.\n' +
    'It should be 30-60 characters. Copy from Google AI Studio or Google Cloud.';
    throw new Error(errorMsg);
  }
  return key;
}

async function prepareMessagesForApi(messages) {
  const imagePaths = new Set();
  messages.forEach(msg => {
    const content = Array.isArray(msg.content) ? msg.content : [];
    content.forEach(block => {
      if (block.type === 'image_url' && block.image_url?.path) {
        imagePaths.add(block.image_url.path);
      }
    });
  });

  let urlMap = {};
  if (imagePaths.size > 0) {
    const { data, error } = await supabase.functions.invoke('get-signed-urls', {
      body: { paths: Array.from(imagePaths), expiresIn: 900 } // 15 minutes
    });
    if (error || data.error) {
      throw new Error(`Failed to get signed URLs for API call: ${error?.message || data.error}`);
    }
    urlMap = data.urlMap;
  }

  const processedMessages = [];
  for (const msg of messages) {
    const contentBlocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];
    
    const finalContent = [];
    for (const block of contentBlocks) {
      if (block.type === 'image_url' && block.image_url?.path) {
        const signedUrl = urlMap[block.image_url.path];
        if (signedUrl) {
          finalContent.push({
            ...block,
            image_url: { ...block.image_url, url: signedUrl }
          });
        } else {
          console.warn(`Could not find signed URL for path: ${block.image_url.path}`);
        }
      } else {
        finalContent.push(block);
      }
    }
    processedMessages.push({ ...msg, content: finalContent });
  }
  return processedMessages;
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

  const messagesWithUrls = await prepareMessagesForApi(messages);

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: validatedKey });
  } catch (err) {
    console.error(`[API - callApiForText @ ${callTimestamp}] @google/genai SDK initialisation failed:`, err.message, err);
    throw new Error('@google/genai SDK initialisation failed: ' + err.message);
  }

  let systemInstructionTextFromMessages = "";
  const historyContents = [];
  console.log(`[API - callApiForText @ ${callTimestamp}] Processing ${messagesWithUrls.length} input messages.`);

  for (const msg of messagesWithUrls) {
    const contentBlocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    const textAndFileParts = contentBlocks.filter(b => b.type !== 'image_url');
    const imagePartsToProcess = contentBlocks.filter(b => b.type === 'image_url' && b.image_url?.url);

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
