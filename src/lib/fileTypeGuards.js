// src/lib/fileTypeGuards.js
// Central gate deciding which files count as “inline text / code”.

export const MAX_TEXT_FILE_SIZE = 300 * 1024;   // 300 KB
export const MAX_CHAR_LEN       = 400_000;      // 400,000 characters

/* ── binary helpers ─────────────────────────────────────────────── */
export function isImage(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  if (/\.(png|jpe?g|gif|bmp|svg|webp|tiff?|ico|avif|heic|heif)$/i.test(file.name)) return true;
  return false;
}

export function isAudioOrVideo(file) {
  if (file.type && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) return true;
  if (/\.(mp3|wav|ogg|flac|aac|m4[ap]|opus|mp4|mov|avi|mkv|webm|flv|wmv)$/i.test(file.name)) return true;
  return false;
}

/* ── allow-listed code / config extensions ─────────────────────── */
// List of extensions for files considered text-like and useful for LLM context
const CODE_EXT_LIST = [
  // Web frontend
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro',
  'html', 'htm',
  'css', 'scss', 'sass', 'less', 'styl', 'postcss',
  // Markup, Docs, Text
  'md', 'mdx', 'markdown', 'rst', 'txt', 'rtf', 'tex', 'log',
  // Data formats
  'json', 'jsonc', 'json5', 'xml', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'env', 'pem', 'key', 'crt', 'conf', 'config', 'cfg', 'properties', 'hcl', 'tfvars',
  // Build systems & Config
  'gradle', 'kts', 'cmake', 'podspec', 'babelrc', 'eslintrc', 'prettierrc', 'stylelintrc', 'browserslistrc', 'editorconfig', 'nvmrc', 'npmrc', 'yarnrc', 'pnpmfile', 'gemfile', 'rakefile', 'procfile', 'tf',
  // Backend & General Purpose Languages
  'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'fs', 'fsi', 'php', 'pl', 'lua', 'r', 'dart', 'ex', 'exs', 'scala', 'clj', 'cljs', 'cljc', 'edn', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'applescript', 'vb', 'vbs',
  // Database & API
  'sql', 'ddl', 'dml', 'graphql', 'gql', 'graphqls', 'sdl', 'proto', 'http',
  // Project/Solution files (often XML)
  'csproj', 'vbproj', 'fsproj', 'sln', 'vcxproj', 'xcconfig', 'pbxproj', 'xcode',
  // Other
  'patch', 'diff', 'liquid', 'erb', 'haml', 'slim', 'tpl', 'twig', 'xaml', 'xsd', 'xsl', 'xslt',
  'mod', 'sum', // Go modules
  // Hugo specific (though .toml, .md, .html are already covered)
  'rss', // RSS feeds are XML
];

// List of common extensionless filenames that are typically plain text and useful
const EXTENSIONLESS_FILENAMES = [
  'makefile', 'dockerfile', 'license', 'readme', 'copying', 'authors', 'contributors', 'changelog', 'news', 'install', 'vagrantfile', 'jenkinsfile', 'gitignore', 'gitattributes', 'gitmodules', 'env', 'hosts', 'crontab', 'kustomization', 'version',
  // More specific config files that might appear without a leading dot
  'npmrc', 'yarnrc', 'pnpmrc', 'babelrc', 'eslintrc', 'prettierrc', 'stylelintrc', 'browserslistrc', 'editorconfig', 'nvmrc',
];

const RE_CODE_EXT = new RegExp(`\\.(${CODE_EXT_LIST.join('|')})$`, 'i');
const RE_EXTENSIONLESS_MATCH = EXTENSIONLESS_FILENAMES.length > 0
  ? new RegExp(`^(${EXTENSIONLESS_FILENAMES.join('|')})$`, 'i')
  : null;

/* ── master predicate ───────────────────────────────────────────── */
export function isTextLike(file) {
  console.log(`[isTextLike DIAGNOSTIC] Checking file: Name: "${file.name}", Type: "${file.type}", Size: ${file.size}`);

  if (!file || typeof file.name !== 'string') {
    console.log(`[isTextLike DIAGNOSTIC] REJECTED: Invalid file object or name missing.`);
    return false;
  }

  // 1) Hard size gate
  if (file.size > MAX_TEXT_FILE_SIZE) {
    console.log(`[isTextLike DIAGNOSTIC] REJECTED by size: "${file.name}" (${file.size} > ${MAX_TEXT_FILE_SIZE})`);
    return false;
  }

  // 2) Explicit MIME tests
  if (file.type && file.type !== "") {
    const lowerMime = file.type.toLowerCase();
    if (lowerMime.startsWith('text/')) {
      console.log(`[isTextLike DIAGNOSTIC] ALLOWED by MIME (text/*): "${file.name}" (Type: ${lowerMime})`);
      return true;
    }
    // Allow common application types that are text-based
    if (/^application\/(json|xml|javascript|yaml|x-yaml|toml|x-sh|x-httpd-php|x-python-code|x-ruby|xhtml\+xml|svg\+xml|atom\+xml|rss\+xml|ld\+json|manifest\+json|wasm)/.test(lowerMime)) {
      console.log(`[isTextLike DIAGNOSTIC] ALLOWED by MIME (application specific text-based): "${file.name}" (Type: ${lowerMime})`);
      return true;
    }
    // If it's clearly an image, audio, or video by MIME, reject it.
    // isImage/isAudioOrVideo also check extensions, but here we rely on their MIME check part.
    if (lowerMime.startsWith('image/') || lowerMime.startsWith('audio/') || lowerMime.startsWith('video/') || lowerMime === 'application/pdf' || lowerMime === 'application/zip' || lowerMime.startsWith('application/vnd.openxmlformats-officedocument') || lowerMime === 'application/octet-stream') {
        // For application/octet-stream and other known binary types, fall through to extension check,
        // UNLESS it's an image/audio/video extension that isImage/isAudioOrVideo would catch.
        if (isImage(file) || isAudioOrVideo(file)) {
             console.log(`[isTextLike DIAGNOSTIC] REJECTED by MIME or extension (isImage or isAudioOrVideo for specific MIME): "${file.name}" (Type: ${lowerMime})`);
             return false;
        }
        // For application/pdf, application/zip, etc., definitely not text-like for direct inclusion.
        if (lowerMime === 'application/pdf' || lowerMime === 'application/zip' || lowerMime.startsWith('application/vnd.openxmlformats-officedocument')) {
            console.log(`[isTextLike DIAGNOSTIC] REJECTED by specific binary MIME type: "${file.name}" (Type: ${lowerMime})`);
            return false;
        }
        // For application/octet-stream, or other unhandled specific application types, proceed to extension check.
        console.log(`[isTextLike DIAGNOSTIC] MIME type "${lowerMime}" for "${file.name}" is octet-stream or unhandled application type, proceeding to extension/name check.`);
    } else {
      // For any other MIME type not explicitly handled (e.g. custom application types), also proceed to extension check.
      console.log(`[isTextLike DIAGNOSTIC] MIME type "${lowerMime}" for "${file.name}" not explicitly handled by primary MIME rules, proceeding to extension/name check.`);
    }
  } else {
    console.log(`[isTextLike DIAGNOSTIC] No MIME type or empty MIME type for "${file.name}", proceeding to extension/name check.`);
  }

  // 3) Extension allow list OR exact filename match for extension-less files
  if (RE_CODE_EXT.test(file.name)) {
    console.log(`[isTextLike DIAGNOSTIC] ALLOWED by extension: "${file.name}"`);
    return true;
  }
  if (RE_EXTENSIONLESS_MATCH && RE_EXTENSIONLESS_MATCH.test(file.name)) {
    // Before allowing extensionless, double-check it's not a known binary by extension if MIME was missing/generic
    if (isImage(file) || isAudioOrVideo(file)) {
        console.log(`[isTextLike DIAGNOSTIC] REJECTED extensionless file "${file.name}" because it matches binary extension patterns.`);
        return false;
    }
    console.log(`[isTextLike DIAGNOSTIC] ALLOWED by extensionless filename match: "${file.name}"`);
    return true;
  }

  console.log(`[isTextLike DIAGNOSTIC] REJECTED by extension/filename: "${file.name}" (Filename did not pass regex tests. RE_CODE_EXT: ${RE_CODE_EXT.source}, RE_EXTENSIONLESS_MATCH: ${RE_EXTENSIONLESS_MATCH ? RE_EXTENSIONLESS_MATCH.source : 'N/A'})`);
  return false;
}
