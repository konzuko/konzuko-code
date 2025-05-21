// src/lib/fileTypeGuards.js
// Central gate deciding which files count as “inline text / code”.

export const MAX_TEXT_FILE_SIZE = 300 * 1024;   // 300 KB
export const MAX_CHAR_LEN       = 200_000;      // << UPDATED: Now 200,000 characters

/* ── binary helpers ─────────────────────────────────────────────── */
export function isImage(file) {
  // Check MIME type first
  if (file.type && file.type.startsWith('image/')) return true;
  // Fallback to extension if MIME type is generic or missing
  if (/\.(png|jpe?g|gif|bmp|svg|webp|tiff?)$/i.test(file.name)) return true;
  return false;
}

export function isAudioOrVideo(file) {
  // Check MIME type first
  if (file.type && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) return true;
  // Fallback to extension if MIME type is generic or missing
  if (/\.(mp3|wav|ogg|flac|m4[ap]|mov|avi|mkv|webm)$/i.test(file.name)) return true;
  return false;
}

/* ── allow-listed code / config extensions ─────────────────────── */
const CODE_EXT = [
  // front-end
  'js','jsx','ts','tsx','mjs','cjs','svelte','vue','astro',
  'css','scss','sass','less',
  // docs & markup
  'html','htm','xml','md','mdx','markdown','txt','csv',
  // data / config
  'json','json5','yaml','yml','toml','ini','cfg','conf','env',
  'gitignore','dockerfile','dockerignore',
  // infra / build
  'makefile','cmake','gradle','npmrc','eslintignore','eslintrc','prettierrc',
  // back-end
  'py','rb','rs','go','java','kt','swift','c','cpp','cc','h','hpp','cs',
  'php','pl','sh','bash','zsh','fish','bat','cmd','ps1',
  // db / api
  'sql','graphql','gql'
]

const RE_CODE_EXT = new RegExp(`\\.(${CODE_EXT.join('|')})$`, 'i')

/* ── master predicate ───────────────────────────────────────────── */
export function isTextLike(file) {
  // console.log(`[isTextLike DIAGNOSTIC] Checking file: Name: "${file.name}", Type: "${file.type}", Size: ${file.size}`); // Diagnostic logging removed for production

  // 1) hard size gate
  if (file.size > MAX_TEXT_FILE_SIZE) {
    // console.log(`[isTextLike DIAGNOSTIC] REJECTED by size: "${file.name}" (${file.size} > ${MAX_TEXT_FILE_SIZE})`);
    return false;
  }

  // 2) explicit MIME tests
  if (file.type && file.type !== "") { 
    if (file.type.startsWith('text/')) {
      // console.log(`[isTextLike DIAGNOSTIC] ALLOWED by MIME (text/*): "${file.name}" (Type: ${file.type})`);
      return true;
    }
    if (/^application\/(json|xml|x-yaml|javascript)/.test(file.type)) {
      // console.log(`[isTextLike DIAGNOSTIC] ALLOWED by MIME (application specific): "${file.name}" (Type: ${file.type})`);
      return true;
    }
    if (isImage(file) || isAudioOrVideo(file)) {
      // console.log(`[isTextLike DIAGNOSTIC] REJECTED by MIME or extension (isImage or isAudioOrVideo): "${file.name}" (Type: ${file.type})`);
      return false;
    }
    // console.log(`[isTextLike DIAGNOSTIC] MIME type "${file.type}" for "${file.name}" not explicitly handled by MIME rules, proceeding to extension check.`);
  } else {
    // console.log(`[isTextLike DIAGNOSTIC] No MIME type or empty MIME type for "${file.name}", proceeding to extension check.`);
  }

  // 3) extension allow list
  const extensionAllowed = RE_CODE_EXT.test(file.name);
  // if (extensionAllowed) {
  //   console.log(`[isTextLike DIAGNOSTIC] ALLOWED by extension: "${file.name}"`);
  // } else {
  //   console.log(`[isTextLike DIAGNOSTIC] REJECTED by extension: "${file.name}" (Filename did not pass regex test: ${RE_CODE_EXT})`);
  // }
  return extensionAllowed;
}

