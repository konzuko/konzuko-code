// ────────────────────────────────────────────────────────────────
//  file: src/api/geminiApi.js   (ROBUST version)
//  – single-point helper used by the app whenever it has to
//    obtain a text answer from Gemini.
//  – hardened with exhaustive error handling, automatic retries
//    for transient faults, and consistent Error objects.
// ────────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import {
  GEMINI_API_TIMEOUT_MS,
  GEMINI_MODEL_NAME,
} from '../config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from '@google/genai';
import { updateMessage } from './supabaseApi.js';

/*──────────────────────── helpers ──────────────────────────────*/

/** App-specific error wrapper – always has `code` & `message`. */
class ApiError extends Error {
  constructor(code = 'UNKNOWN', message = 'Unspecified error', cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/** Minimal key validator. Throws ApiError on failure. */
function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-]{30,60}$/.test(key)) {
    throw new ApiError(
      'BAD_KEY',
      'Gemini API key missing or malformed; obtain one at https://aistudio.google.com'
    );
  }
  return key;
}

/** Transient error classifier for automatic retries. */
function isRetryable(err) {
  if (!err) return false;
  // Errors bubbled from the Google library normally have `.code`.
  // Also check `.status` from REST responses.
  const code = err.code ?? err.status ?? '';
  return (
    code === 429 || // rate-limit
    code === 408 || // timeout
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    // Node fetch / browser fetch network failures:
    err.name === 'FetchError' ||
    err.message?.includes('network') ||
    err.message?.includes('timeout')
  );
}

/**
 * Run `fn()` with an exponential back-off retry policy.
 * – waitTimes =  [0, 0.5s, 1s, 2s]  (customisable)
 * – if fn() never succeeds, the *last* error is thrown.
 */
async function withRetries(fn, waitTimes = [0, 500, 1000, 2000]) {
  let lastErr;
  for (let i = 0; i < waitTimes.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, waitTimes[i]));
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) break; // fail fast on permanent errors
    }
  }
  throw lastErr;
}

/** Obtain a signed URL (15-min lifetime) from our Supabase EdgeFn */
async function getSignedUrl(path) {
  const { data, error } = await supabase.functions.invoke(
    'get-signed-urls',
    {
      body: { paths: [path], expiresIn: 900 },
    }
  );
  if (error) throw new ApiError('SIGNED_URL', error.message, error);
  if (data.error)
    throw new ApiError('SIGNED_URL', data.error, new Error(data.error));
  return data.urlMap?.[path] ?? null;
}

/**
 * Upload an image to Gemini’s Files API, then persist BOTH
 *     file_id  – full resource path (projects/.../files/abc)
 *     file_uri – short "files/abc"   (used in generateContent)
 * into the message row so future calls do not re-upload.
 *
 * returns { file_uri, mimeType }
 */
async function uploadAndCacheFileUri({
  apiKey,
  messageId,
  blockIndex,
  imageUrlBlock,
}) {
  const path = imageUrlBlock.image_url?.path;
  if (!path) {
    throw new ApiError('NO_STORAGE_PATH', 'Image block missing "path"');
  }

  // fetch blob from Supabase storage
  const blob = await withRetries(async () => {
    const signed = await getSignedUrl(path);
    if (!signed)
      throw new ApiError(
        'SIGNED_URL',
        `Could not create signed URL for "${path}"`
      );
    const res = await fetch(signed);
    if (!res.ok) {
      throw new ApiError(
        'FETCH_BLOB',
        `HTTP ${res.status} while downloading "${path}"`
      );
    }
    return await res.blob();
  });

  // upload to Gemini
  const genAI = new GoogleGenAI({ apiKey });
  const uploaded = await withRetries(() =>
    genAI.files.upload({
      file: blob,
      config: {
        mimeType: blob.type || 'image/webp',
        displayName:
          imageUrlBlock.image_url.original_name || 'uploaded.webp',
      },
    })
  );

  const { name: file_id, uri: file_uri, mimeType } = uploaded;
  if (!file_uri) {
    throw new ApiError('UPLOAD', 'Files API response missing "uri"');
  }

  /* persist file_id & file_uri back to Supabase --------- */
  const { data: msg, error } = await supabase
    .from('messages')
    .select('content')
    .eq('id', messageId)
    .single();
  if (error) throw new ApiError('DB', error.message, error);
  if (!msg) throw new ApiError('DB', `Message ${messageId} not found`);

  const newContent = [...msg.content];
  newContent[blockIndex] = {
    ...imageUrlBlock,
    image_url: {
      ...imageUrlBlock.image_url,
      file_id,
      file_uri,
      mime_type: mimeType,
    },
  };
  await updateMessage(messageId, newContent);

  return { file_uri, mimeType };
}

/*────────────────── main exported helper ───────────────────────*/

export async function callApiForText({
  messages = [],
  apiKey = '',
  signal,
} = {}) {
  const validatedKey = validateKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: validatedKey });

  let extraSystem = '';
  const contents = [];

  // ── build History → Parts array ──────────────────────────────
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    const parts = [];

    for (const [idx, block] of blocks.entries()) {
      /* TEXT */
      if (block.type === 'text') {
        if (block.text?.trim())
          parts.push({ text: block.text });
        continue;
      }

      /* IMAGE */
      if (block.type === 'image_url' && block.image_url) {
        let fileUri = block.image_url.file_uri;
        let mimeType = block.image_url.mime_type || 'image/webp';

        if (!fileUri) {
          const up = await uploadAndCacheFileUri({
            apiKey: validatedKey,
            messageId: msg.id,
            blockIndex: idx,
            imageUrlBlock: block,
          });
          fileUri = up.file_uri;
          mimeType = up.mimeType;
        }
        parts.push({ fileData: { mimeType, fileUri } });
        continue;
      }

      /* OTHER FILE – assume gemini-compatible */
      if (block.type === 'file' && block.file?.file_id) {
        let fileUri = block.file.file_id;
        if (!fileUri.startsWith('files/')) fileUri = `files/${fileUri}`;
        parts.push({
          fileData: { mimeType: block.file.mime_type, fileUri },
        });
      }
    }

    if (!parts.length) continue;

    if (msg.role === 'system') {
      const firstText = parts.find((p) => p.text)?.text;
      if (firstText) {
        extraSystem += (extraSystem ? '\n' : '') + firstText;
      }
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts,
      });
    }
  }

  const systemInstruction = [
    HARDCODED_GEMINI_SYSTEM_PROMPT,
    extraSystem.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  const requestPayload = {
    model: GEMINI_MODEL_NAME,
    contents,
    config: {
      temperature: 0,
      topP: 0.95,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      ...(systemInstruction && { systemInstruction }),
    },
  };

  /* ── manual timeout + abort chaining ───────────────────────── */
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort());

  const timeout = setTimeout(
    () => ctrl.abort(new ApiError('TIMEOUT', 'Request timed out')),
    GEMINI_API_TIMEOUT_MS
  );

  try {
    const response = await withRetries(() =>
      ai.models.generateContent(requestPayload, {
        signal: ctrl.signal,
      })
    );

    clearTimeout(timeout);

    const cand = response?.candidates?.[0];
    if (!cand)
      throw new ApiError('NO_RESPONSE', 'Model returned no candidates');

    if (cand.finishReason === 'SAFETY') {
      throw new ApiError(
        'SAFETY',
        'Generation stopped because of safety filters'
      );
    }

    const text =
      cand.content?.parts?.map((p) => p.text).join('') ?? '';

    if (!text) {
      throw new ApiError('EMPTY', 'Model returned empty text.');
    }

    return { content: text };

  } catch (err) {
    clearTimeout(timeout);
    // Normalise unknown errors
    if (!(err instanceof ApiError)) {
      throw new ApiError(err.code ?? 'ERROR', err.message ?? String(err), err);
    }
    throw err;
  }
}
