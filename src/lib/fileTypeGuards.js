// src/lib/fileTypeGuards.js
// Central gate deciding which files count as “inline text / code”.

export const MAX_TEXT_FILE_SIZE = 300 * 1024;   // 300 KB
export const MAX_CHAR_LEN       = 50_000;       // ≈12–15 k tokens

/* ── binary helpers ─────────────────────────────────────────────── */
export function isImage(file) {
  return file.type.startsWith('image/') ||
         /\.(png|jpe?g|gif|bmp|svg|webp|tiff?)$/i.test(file.name)
}

export function isAudioOrVideo(file) {
  return file.type.startsWith('audio/') ||
         file.type.startsWith('video/') ||
         /\.(mp3|wav|ogg|flac|m4[ap]|mov|avi|mkv|webm)$/i.test(file.name)
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
  // 1) hard size gate
  if (file.size > MAX_TEXT_FILE_SIZE) return false

  // 2) explicit MIME tests
  if (file.type) {
    if (file.type.startsWith('text/'))                        return true
    if (/^application\/(json|xml|x-yaml|javascript)/.test(file.type))
      return true
    if (isImage(file) || isAudioOrVideo(file))                return false
  }

  // 3) extension allow list
  return RE_CODE_EXT.test(file.name)
}
