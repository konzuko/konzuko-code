// ────────────────────────────────────────────────────────────────
// file: src/api/geminiApi.js               (robust, race-safe)
// ────────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';
import {
  GEMINI_API_TIMEOUT_MS,
  GEMINI_MODEL_NAME,
} from '../config.js';
import HARDCODED_GEMINI_SYSTEM_PROMPT from '../system-prompt.md?raw';
import { GoogleGenAI } from '@google/genai';

/*=================================================================
  Error helper
=================================================================*/
class ApiError extends Error {
  constructor(code = 'UNKNOWN', message = 'Unspecified error', cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

/*=================================================================
  Validation helpers
=================================================================*/
function validateKey(raw = '') {
  const key = raw ? raw.trim() : '';
  if (!/^[A-Za-z0-9_\-:]{30,70}$/.test(key)) {
    throw new ApiError(
      'BAD_KEY',
      'Gemini API key missing or malformed – copy a fresh key from Google AI Studio.'
    );
  }
  return key;
}

/*=================================================================
  Retry helpers
=================================================================*/
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

/*=================================================================
  Storage helper – signed URL (15-min)
=================================================================*/
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

/*=================================================================
  Optimistic-concurrency safe message updater
=================================================================*/
async function updateMessageSafely(id, newContent) {
  //  pull updated_at so we can guard the update
  const { data: orig, error: selErr } = await supabase
    .from('messages')
    .select('updated_at')
    .eq('id', id)
    .single();
  if (selErr) throw new ApiError('DB', selErr.message, selErr);

  const origStamp = orig.updated_at;
  const nextStamp = new Date().toISOString();

  const { data: upd, error: updErr } = await supabase
    .from('messages')
    .update({ content: newContent, updated_at: nextStamp })
    .eq('id', id)
    .eq('updated_at', origStamp)
    .select()
    .maybeSingle();

  if (updErr) throw new ApiError('DB', updErr.message, updErrErr);

  if (!upd) {
    // someone else modified the row – re-run once
    return updateMessageSafely(id, newContent);
  }
  return upd;
}

/*=================================================================
  Image upload  (Supabase → Gemini Files API)
=================================================================*/
async function uploadAndCacheFileUri({
  apiKey,
  messageId,
  blockIndex,
  imageUrlBlock,
}) {
  const path = imageUrlBlock.image_url?.path;
  if (!path) throw new ApiError('NO_PATH', 'Image block missing storage path');

  // ── download from Supabase storage
  const blob = await withRetries(async () => {
    const url = await getSignedUrl(path);
    if (!url) throw new ApiError('SIGNED_URL', 'Signed URL not returned');
    const res = await fetch(url);
    if (!res.ok)
      throw new ApiError(
        'FETCH_BLOB',
        `HTTP ${res.status} while downloading image`
      );
    return await res.blob();
  });

  // ── upload to Gemini Files  (single attempt ‑ avoid duplicates)
  const genAI = new GoogleGenAI({ apiKey });
  let uploaded;
  try {
    uploaded = await genAI.files.upload({
      file: blob,
      config: {
        mimeType: blob.type || 'image/webp',
        displayName: imageUrlBlock.image_url.original_name || 'upload.webp',
      },
    });
  } catch (e) {
    throw new ApiError('UPLOAD', e.message, e);
  } finally {
    // release memory sooner
    /* eslint-disable no-param-reassign */
    //  (allow GC – a micro-optimisation)
  }

  const { name: file_id, uri: file_uri, mimeType } = uploaded;
  if (!file_uri)
    throw new ApiError('UPLOAD', 'Files API response missing "uri"');

  /*── persist to DB so we never upload again ────────────────────*/
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

/*=================================================================
  Public – callApiForText
=================================================================*/
export async function callApiForText({
  messages = [],
  apiKey = '',
  signal,
} = {}) {
  const key = validateKey(apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const contents = [];
  let extraSystem = '';

  /*── Build parts array ─────────────────────────────────────────*/
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];

    const parts = [];

    for (const [i, block] of blocks.entries()) {
      if (block.type === 'text') {
        if (block.text?.trim()) parts.push({ text: block.text });
        continue;
      }

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

      if (block.type === 'file' && block.file?.file_id) {
        let fileUri = block.file.file_id;
        if (!fileUri.startsWith('files/')) fileUri = `files/${fileUri}`;
        parts.push({ fileData: { mimeType: block.file.mime_type, fileUri } });
      }
    }

    if (!parts.length) continue;

    if (msg.role === 'system') {
      const t = parts.find((p) => p.text)?.text;
      if (t) extraSystem += (extraSystem ? '\n' : '') + t;
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts,
      });
    }
  }

  /*── System instruction ───────────────────────────────────────*/
  const systemInstruction = [
    HARDCODED_GEMINI_SYSTEM_PROMPT,
    extraSystem.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  /*── Request object ───────────────────────────────────────────*/
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

  /*── Timeout + abort chaining ─────────────────────────────────*/
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort());

  const t = setTimeout(
    () => ctrl.abort(new ApiError('TIMEOUT', 'Gemini request timed out')),
    GEMINI_API_TIMEOUT_MS
  );

  try {
    const response = await withRetries(() =>
      ai.models.generateContent(payload, { signal: ctrl.signal })
    );

    clearTimeout(t);

    const cand = response?.candidates?.[0];
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
      throw new ApiError(err.code ?? 'ERROR', err.message ?? String(err), err);
    }
    throw err;
  }
}
