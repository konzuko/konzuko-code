// file: src/config.js
// Centralised tuning knobs & feature flags
export const GEMINI_API_TIMEOUT_MS = 100 * 1_000;      // 100-second hard timeout for Gemini API
export const LOCALSTORAGE_DEBOUNCE = 300;              // ms before we persist
export const FILE_LIMIT            = 3000;             // Hidden internal limit for CodebaseImporter
export const IMAGE_TOKEN_ESTIMATE  = 258;              // Estimated token count for a single image with Gemini

// NEW: Add model name here
export const GEMINI_MODEL_NAME = "gemini-2.5-pro-preview-06-05";

// Token limit constants
export const USER_FACING_TOKEN_LIMIT = 350000;    // Soft warning limit
export const MAX_ABSOLUTE_TOKEN_LIMIT = 1000000;  // Hard limit for sending

// LocalStorage Keys
export const LOCALSTORAGE_FORM_KEY = 'konzuko-form-data';
export const LOCALSTORAGE_SETTINGS_KEY = 'konzuko-display-settings';
export const LOCALSTORAGE_MODE_KEY = 'konzuko-mode';
export const LOCALSTORAGE_LAST_CHAT_ID_KEY = 'konzuko-lastChatId';
export const LOCALSTORAGE_PANE_WIDTH_KEY = 'konzuko-pane-width';
export const LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY = 'konzuko-sidebar-collapsed';
