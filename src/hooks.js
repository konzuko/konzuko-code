/* -------------------------------------------------------------------------
   src/hooks.js
   Shared utility hooks + file/dir helpers

   NOTE
   ----
   • The old synchronous token counter has been deleted.
   • We now *re-export* the worker-based implementation from
     "hooks/useTokenCount.js".  -> THIS COMMENT IS NOW OUTDATED.
     The old useTokenCount.js (tiktoken for chat messages) will be removed.
     The new prompt token counting logic is in App.jsx.
---------------------------------------------------------------------------*/

import {
  useState,
  useEffect,
  useCallback,
  // useRef // Not used directly in this file anymore
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
  developReturnFormat: 'return the complete refactored code for the respective changed files in FULL with NO OMISSIONS so that i can paste it directly into my ide',
  developWarnings: '',
  // developContext: '', // Removed as per request
  fixCode: '',
  fixErrors: ''
};

/* ───────────────────── localStorage helpers ─────────────────── */
function useDebouncedLocalStorage(key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue !== null) {
        const parsed = JSON.parse(storedValue);
        // Ensure the model is always the target model if it exists in settings
        if (key === 'konzuko-settings' && parsed.hasOwnProperty('model')) {
            parsed.model = TARGET_GEMINI_MODEL;
        }
        // For form data, if it's loaded from localStorage, it's user's draft.
        // The 'initial' (INITIAL_FORM_DATA) is primarily for the very first load
        // or when explicitly resetting.
        return parsed;
      }
      return initial; // Use the passed 'initial' (which will be INITIAL_FORM_DATA for form)
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        // Ensure the model is always the target model before saving settings
        let valueToStore = value;
        if (key === 'konzuko-settings' && valueToStore && typeof valueToStore === 'object' && valueToStore.hasOwnProperty('model')) {
            // Create a new object to ensure reactivity if value itself is not changing but its property is
            valueToStore = { ...valueToStore, model: TARGET_GEMINI_MODEL };
        }
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (err) {
        console.warn('localStorage error:', err);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [key, value, delay]);

  return [value, setValue];
}

export function useSettings() {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey       : '',
    model        : TARGET_GEMINI_MODEL,
    showSettings : false
  });
}

export function useFormData() {
  // Use the exported constant here for the initial state if nothing in localStorage
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

/* 
   No re-export of useTokenCount as it's being removed.
   usePromptTokenCount was also removed.
*/

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

