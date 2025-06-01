/* -------------------------------------------------------------------------
   src/hooks.js
   Shared utility hooks + file/dir helpers
---------------------------------------------------------------------------*/

import {
  useState,
  useEffect,
  useCallback,
} from 'preact/hooks';

import { LOCALSTORAGE_DEBOUNCE } from './config.js';
import { isTextLike, isImage }   from './lib/fileTypeGuards.js';

/* ───────────────────────── constants ────────────────────────── */
const MAX_TOTAL_DROPPED_FILES = 2000;
const TARGET_GEMINI_MODEL = "gemini-2.5-pro-preview-05-06";

// Define the initial structure for the form data
export const INITIAL_FORM_DATA = {
  developGoal: '',
  developFeatures: '',
  developReturnFormat_custom: '',
  developReturnFormat_autoIncludeDefault: true,
  developWarnings: '',
  fixCode: '',
  fixErrors: ''
};

/* ───────────────────── localStorage helpers ─────────────────── */
// This generic hook remains, but its usage for settings will change.
function useDebouncedLocalStorage(key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue !== null) {
        let parsed = JSON.parse(storedValue);
        // Special handling for 'konzuko-form-data' (merging)
        if (key === 'konzuko-form-data') {
            parsed = { ...initial, ...parsed };
        }
        // Special handling for 'konzuko-display-settings' (model enforcement)
        // This is now handled by useDisplaySettings itself to keep this hook generic.
        // if (key === 'konzuko-display-settings' && parsed.hasOwnProperty('model')) {
        //     parsed.model = TARGET_GEMINI_MODEL;
        // }
        return parsed;
      }
      return initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        let valueToStore = value;
        // Model enforcement for 'konzuko-display-settings' is handled by useDisplaySettings.
        // if (key === 'konzuko-display-settings' && valueToStore && typeof valueToStore === 'object' && valueToStore.hasOwnProperty('model')) {
        //     valueToStore = { ...valueToStore, model: TARGET_GEMINI_MODEL };
        // }
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (err) {
        console.warn('localStorage error:', err);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [key, value, delay]);

  return [value, setValue];
}

// Manages display-related settings (model, showSettings), persisted to localStorage.
// API key is NOT managed here anymore.
export function useDisplaySettings() {
  const [displaySettings, setDisplaySettings] = useDebouncedLocalStorage('konzuko-display-settings', {
    model        : TARGET_GEMINI_MODEL, // Default model
    showSettings : false                 // Default for showing settings panel
    // apiKey is intentionally removed from here
  });

  // Ensure the model is always the target model, even if localStorage had something else.
  useEffect(() => {
    if (displaySettings.model !== TARGET_GEMINI_MODEL) {
      setDisplaySettings(s => ({ ...s, model: TARGET_GEMINI_MODEL }));
    }
  }, [displaySettings.model, setDisplaySettings]);

  return [displaySettings, setDisplaySettings];
}


export function useFormData() {
  return useDebouncedLocalStorage('konzuko-form-data', INITIAL_FORM_DATA);
}

/* ───────────────────── BFS dir scanning ───────────────────────── */
async function readEntriesPromise(reader) {
  return new Promise((res, rej) => reader.readEntries(res, rej));
}

async function bfsTraverseWebkitEntry(rootEntry, out = [], max = MAX_TOTAL_DROPPED_FILES) {
  const q = [rootEntry];
  while (q.length && out.length < max) {
    const e = q.shift();
    if (e.isFile) out.push(e);
    else if (e.isDirectory) {
      const rdr = e.createReader();
      let batch = await readEntriesPromise(rdr);
      while (batch.length && out.length < max) {
        q.push(...batch);
        batch = await readEntriesPromise(rdr);
      }
    }
  }
  return out;
}

function entryToFile(entry) {
  return new Promise((res, rej) => {
    entry.file(
      f => {
        f.fullPath = entry.fullPath || f.name;
        res(f);
      },
      err => rej(err)
    );
  });
}

async function bfsTraverseFsHandle(rootHandle, out = [], max = MAX_TOTAL_DROPPED_FILES) {
  const q = [rootHandle];
  while (q.length && out.length < max) {
    const h = q.shift();
    if (h.kind === 'file') {
      const f = await h.getFile();
      f.fullPath = h.name; 
      out.push(f);
    } else if (h.kind === 'directory') {
      for await (const [, child] of h.entries()) {
        if (out.length >= max) break;
        q.push(child);
      }
    }
  }
  return out;
}

async function gatherAllDroppedFiles(items) {
  const out = [];
  for (let i = 0; i < items.length && out.length < MAX_TOTAL_DROPPED_FILES; i++) {
    const it = items[i];
    if (it.kind !== 'file' && typeof it.getAsFileSystemHandle !== 'function' && typeof it.webkitGetAsEntry !== 'function') {
        continue;
    }

    if (it.getAsFileSystemHandle) {
      try {
        const h = await it.getAsFileSystemHandle();
        await bfsTraverseFsHandle(h, out, MAX_TOTAL_DROPPED_FILES);
        continue;
      } catch(e) {
        // console.warn("Error with getAsFileSystemHandle:", e);
      }
    }

    if (it.webkitGetAsEntry) {
      const ent = it.webkitGetAsEntry();
      if (ent) {
        const entries = await bfsTraverseWebkitEntry(
          ent, [], MAX_TOTAL_DROPPED_FILES - out.length
        );
        const files = await Promise.all(entries.map(entryToFile));
        out.push(...files.slice(0, MAX_TOTAL_DROPPED_FILES - out.length));
        continue;
      }
    }

    const file = it.getAsFile();
    if (file) {
      file.fullPath = file.name;
      out.push(file);
    }
  }
  return out.slice(0, MAX_TOTAL_DROPPED_FILES);
}

/* ───────────────────── useFileDrop ───────────────────────────── */
export function useFileDrop(onText, onImage) {
  const dragOver = useCallback(e => e.preventDefault(), []);

  const drop = useCallback(
    async e => {
      e.preventDefault();
      const files = await gatherAllDroppedFiles(e.dataTransfer.items);

      for (const f of files) {
        if (isImage(f)) {
          if (onImage) {
            const url = URL.createObjectURL(f);
            const revoke = () => URL.revokeObjectURL(url);
            onImage(f.name, url, revoke);
          }
          continue;
        }
        if (!isTextLike(f)) continue;
        await new Promise(res => {
          const r = new FileReader();
          r.onload = () => {
            onText(String(r.result), f);
            res();
          };
          r.readAsText(f);
        });
      }
    },
    [onText, onImage]
  );

  return { dragOver, drop };
}

/* ───────────────────── useMode + Undoable delete ─────────────── */
export function useMode() {
  const ALLOWED = ['DEVELOP', 'COMMIT', 'CODE CHECK'];
  const stored  = localStorage.getItem('konzuko-mode');
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP';
  const [mode, _setMode] = useState(initial);

  useEffect(() => {
    localStorage.setItem('konzuko-mode', mode);
  }, [mode]);

  const setMode = val => ALLOWED.includes(val) && _setMode(val);
  return [mode, setMode];
}

export function useUndoableDelete(showToast) {
  return useCallback(
    async ({ itemLabel, confirmMessage, deleteFn, undoFn, afterDelete }) => {
      const ok = confirm(
        confirmMessage ??
          `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`
      );
      if (!ok) return;

      try {
        await deleteFn();
        afterDelete?.();
        showToast(`${itemLabel} deleted.`, undoFn);
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    },
    [showToast]
  );
}
