// Centralised tuning knobs & feature flags
export const GEMINI_API_TIMEOUT_MS = 11 * 60 * 1_000;  // 11-minute hard timeout for Gemini API
export const LOCALSTORAGE_DEBOUNCE = 300;              // ms before we persist
export const FILE_LIMIT            = 500;              // Max number of text files
export const IMAGE_TOKEN_ESTIMATE  = 258;              // Estimated token count for a single image with Gemini
