// ────────────────────────────────────────────────────────────────
// src/api/geminiApi.js
// Robust Gemini bridge – image upload, retry, optimism-lock safe
// ────────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import {
  GEMINI_API_TIMEOUT_MS,
  GEMINI_MODEL_NAME,
} from '../config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from '@google/genai';

/* =================================================================
   1. Error class
   ===============================================================*/
export class ApiError extends Error {
  constructor(code = 'UNKNOWN', message = 'Unspecified error', cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/* =================================================================
   2. Helpers – validation & retries
   ===============================================================*/
function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  // allow future console keys with “:” as separator
  if (!/^[A-Za-z0-9_\-:]{30,70}$/.test(key)) {
    throw new ApiError(
      'BAD_KEY',
      'Gemini API key missing or malformed – copy a fresh key from Google AI Studio'
    );
  }
  return key;
}

function isRetryable(err) {
  if (!err) return false;
  const code = err.code ?? err.status ?? '';
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504 ||
    code === 408 ||
    code === 'UNAVAILABLE' ||
    code === 'ABORTED' ||
    err.name === 'FetchError' ||
    err.message?.includes('network') ||
    err.message?.includes('timeout') ||
    err.message?.includes('ECONNRESET') ||
    err.message?.includes('ETIMEDOUT')
  );
}

async function withRetries(fn, wait = [0, 500, 1000, 2000, 4000]) {
  let lastErr;
  for (let i = 0; i < wait.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, wait[i]));
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) break;
    }
  }
  throw lastErr;
}

/* =================================================================
   3. Storage – signed URL (15 min)
   ===============================================================*/
async function getSignedUrl(path) {
  const { data, error } = await supabase.functions.invoke(
    'get-signed-urls',
    { body: { paths: [path], expiresIn: 900 } }
  );
  if (error)
    throw new ApiError('SIGNED_URL', 'Failed to create signed URL', error);
  if (data.error)
    throw new ApiError('SIGNED_URL', data.error, new Error(data.error));
  return data.urlMap?.[path] ?? null;
}

/* =================================================================
   4. Optimistic concurrency safe update
   ===============================================================*/
async function updateMessageSafely(id, newContent, attempt = 0) {
  if (attempt > 2) {
    throw new ApiError(
      'DB',
      'Could not update message after 3 concurrent attempts'
    );
  }

  const { data: row, error: selErr } = await supabase
    .from('messages')
    .select('updated_at')
    .eq('id', id)
    .single();

  if (selErr) throw new ApiError('DB', selErr.message, selErr);

  const baseQuery = supabase
    .from('messages')
    .update({
      content: newContent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  // only guard when column is NOT null
  const guardedQuery =
    row && row.updated_at !== null
      ? baseQuery.eq('updated_at', row.updated_at)
      : baseQuery;

  const { data: upRow, error: updErr } = await guardedQuery
    .select()
    .maybeSingle();

  if (updErr) throw new ApiError('DB', updErr.message, updErr);

  // concurrent modification → retry once
  if (!upRow) return updateMessageSafely(id, newContent, attempt + 1);
  return upRow;
}

/* =================================================================
   5. Upload image to Gemini Files API
   ===============================================================*/
async function uploadAndCacheFileUri({
  apiKey,
  messageId,
  blockIndex,
  imageUrlBlock,
}) {
  const path = imageUrlBlock.image_url?.path;
  if (!path) {
    throw new ApiError('NO_PATH', 'Image block missing storage path');
  }

  // download blob from Supabase
  const blob = await withRetries(async () => {
    const url = await getSignedUrl(path);
    if (!url)
      throw new ApiError('SIGNED_URL', 'Signed URL not returned by function');
    const res = await fetch(url);
    if (!res.ok)
      throw new ApiError(
        'FETCH_BLOB',
        `HTTP ${res.status} while downloading image`
      );
    return res.blob();
  });

  // single-try upload (avoid duplicates)
  const genAI = new GoogleGenAI({ apiKey });
  let uploaded;
  try {
    uploaded = await genAI.files.upload({
      file: await blob,
      config: {
        mimeType: (await blob).type || 'image/webp',
        displayName:
          imageUrlBlock.image_url.original_name || 'upload.webp',
      },
    });
  } catch (e) {
    throw new ApiError('UPLOAD', e.message, e);
  }

  const { name: file_id, uri: file_uri, mimeType } = uploaded;
  if (!file_uri)
    throw new ApiError('UPLOAD', 'Files API response missing "uri"');

  // persist file_id + file_uri
  const { data: msgRow, error } = await supabase
    .from('messages')
    .select('content')
    .eq('id', messageId)
    .single();
  if (error) throw new ApiError('DB', error.message, error);

  const newContent = [...msgRow.content];
  newContent[blockIndex] = {
    ...imageUrlBlock,
    image_url: {
      ...imageUrlBlock.image_url,
      file_id,
      file_uri,
      mime_type: mimeType,
    },
  };

  await updateMessageSafely(messageId, newContent);
  return { file_uri, mimeType };
}

/* =================================================================
   6. Public helper
   ===============================================================*/
export async function callApiForText({
  messages = [],
  apiKey = '',
  signal,
} = {}) {
  const key = validateKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const contents = [];
  let extraSystem = '';

  for (const msg of messages) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    const parts = [];

    for (const [i, block] of blocks.entries()) {
      // TEXT
      if (block.type === 'text') {
        if (block.text?.trim()) parts.push({ text: block.text });
        continue;
      }

      // IMAGE
      if (block.type === 'image_url' && block.image_url) {
        let fileUri = block.image_url.file_uri;
        let mimeType = block.image_url.mime_type || 'image/webp';

        if (!fileUri) {
          const up = await uploadAndCacheFileUri({
            apiKey: key,
            messageId: msg.id,
            blockIndex: i,
            imageUrlBlock: block,
          });
          fileUri = up.file_uri;
          mimeType = up.mimeType;
        }
        parts.push({ fileData: { mimeType, fileUri } });
        continue;
      }

      // OTHER GEMINI-COMPATIBLE FILE
      if (block.type === 'file' && block.file?.file_id) {
        let fileUri = block.file.file_id;
        if (!fileUri.startsWith('files/')) fileUri = `files/${fileUri}`;
        parts.push({
          fileData: {
            mimeType: block.file.mime_type,
            fileUri,
          },
        });
      }
    }

    if (!parts.length) continue;

    if (msg.role === 'system') {
      const firstText = parts.find((p) => p.text)?.text;
      if (firstText) extraSystem += (extraSystem ? '\n' : '') + firstText;
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

  const payload = {
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

  // timeout + abort chaining
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort());

  const t = setTimeout(
    () => ctrl.abort(new ApiError('TIMEOUT', 'Gemini request timed out')),
    GEMINI_API_TIMEOUT_MS
  );

  try {
    const resp = await withRetries(() =>
      ai.models.generateContent(payload, { signal: ctrl.signal })
    );

    clearTimeout(t);

    const cand = resp?.candidates?.[0];
    if (!cand)
      throw new ApiError('NO_RESPONSE', 'Model returned no candidates');

    if (cand.finishReason === 'SAFETY') {
      throw new ApiError(
        'SAFETY',
        'Generation stopped by safety filters'
      );
    }

    const text = cand.content?.parts?.map((p) => p.text).join('');
    if (!text) throw new ApiError('EMPTY', 'Model returned empty text');
    return { content: text };
  } catch (err) {
    clearTimeout(t);
    if (!(err instanceof ApiError)) {
      throw new ApiError(
        err.code ?? 'ERROR',
        err.message ?? String(err),
        err
      );
    }
    throw err;
  }
}
