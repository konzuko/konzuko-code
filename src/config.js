// Centralised tuning knobs & feature flags
export const GEMINI_API_TIMEOUT_MS = 11 * 60 * 1_000;  // 11-minute hard timeout for Gemini API
export const LOCALSTORAGE_DEBOUNCE = 300;              // ms before we persist
export const FILE_LIMIT            = 3000;             // Hidden internal limit for CodebaseImporter
export const IMAGE_TOKEN_ESTIMATE  = 258;              // Estimated token count for a single image with Gemini

// NEW: Token limit constants
export const USER_FACING_TOKEN_LIMIT = 350000;    // Soft warning limit
export const MAX_ABSOLUTE_TOKEN_LIMIT = 1000000;  // Hard limit for sending
