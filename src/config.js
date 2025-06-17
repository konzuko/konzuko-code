// file: src/config.js
// ---------------------------------------------------------------------------
// 🛠  Centralised tuning knobs & feature flags
// ---------------------------------------------------------------------------

// Stripe Configuration
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
// REMOVED: STRIPE_PRICE_ID is no longer a single global config.

// ‼️ TIME-OUTS (ms) ----------------------------------------------------------
// Use env-var override in production → VITE_GEMINI_TIMEOUT_MS (ms)
const DEFAULT_GEMINI_TIMEOUT = 400_000;               // 6 min 40 sec
export const GEMINI_API_TIMEOUT_MS = Number(
  import.meta?.env?.VITE_GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT
);

// Debounce delay for token-count worker (idle typing pause)
export const TOKEN_COUNT_DEBOUNCE_MS = 1_500;          // 1.5 s

// Other core constants ------------------------------------------------------
export const LOCALSTORAGE_DEBOUNCE        = 300;       // ms before we persist
export const FILE_LIMIT                   = 3000;      // Hidden internal limit for CodebaseImporter
export const IMAGE_TOKEN_ESTIMATE         = 258;       // Estimated token count for a single image with Gemini
export const MAX_CUMULATIVE_FILE_SIZE     = 20 * 1024 * 1024; // 20 MB cumulative file import size

export const GEMINI_MODEL_NAME = 'gemini-2.5-pro-preview-06-05';

// Token limits (original values)
export const USER_FACING_TOKEN_LIMIT  = 350_000; // soft warning
export const MAX_ABSOLUTE_TOKEN_LIMIT = 1_000_000; // hard cap

// LocalStorage keys ---------------------------------------------------------
export const LOCALSTORAGE_FORM_KEY              = 'konzuko-form-data';
export const LOCALSTORAGE_SETTINGS_KEY          = 'konzuko-display-settings';
export const LOCALSTORAGE_MODE_KEY              = 'konzuko-mode';
export const LOCALSTORAGE_LAST_CHAT_ID_KEY      = 'konzuko-lastChatId';
export const LOCALSTORAGE_PANE_WIDTH_KEY        = 'konzuko-pane-width';
export const LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY = 'konzuko-sidebar-collapsed';
