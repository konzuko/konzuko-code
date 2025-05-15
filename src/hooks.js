/* -------------------------------------------------------------------------
   src/hooks.js
   Shared utility hooks + file/dir helpers

   NOTE
   ----
   • The old synchronous token counter has been deleted.
   • We now *re-export* the worker-based implementation from
     "hooks/useTokenCount.js".
---------------------------------------------------------------------------*/

import {
  useState,
  useEffect,
  useCallback,
  useRef
} from 'preact/hooks';

import { LOCALSTORAGE_DEBOUNCE } from './config.js';
import { isTextLike, isImage }   from './lib/fileTypeGuards.js';

/* ───────────────────────── constants ────────────────────────── */
const MAX_TOTAL_DROPPED_FILES = 2000;

/* ───────────────────── localStorage helpers ─────────────────── */
function useDebouncedLocalStorage(key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
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
    model        : 'gpt-3.5-turbo',
    codeType     : 'javascript',
    showSettings : false
  });
}

export function useFormData() {
  return useDebouncedLocalStorage('konzuko-form-data', {
    developGoal         : '',
    developFeatures     : '',
    developReturnFormat :
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings     : '',
    developContext      : '',
    fixCode             : '',
    fixErrors           : ''
  });
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
      f.fullPath = f.fullPath || f.name;
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
    if (it.kind !== 'file') continue;

    /* 1) File-System Access API BFS */
    if (it.getAsFileSystemHandle) {
      try {
        const h = await it.getAsFileSystemHandle();
        await bfsTraverseFsHandle(h, out, MAX_TOTAL_DROPPED_FILES);
        continue;
      } catch {}
    }

    /* 2) WebKit directory BFS */
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

    /* 3) Fallback single file */
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
        /* A) image */
        if (isImage(f)) {
          if (onImage) {
            const url = URL.createObjectURL(f);
            const revoke = () => URL.revokeObjectURL(url);
            onImage(f.name, url, revoke);
          }
          continue;
        }
        /* B) non-text skip */
        if (!isTextLike(f)) continue;
        /* C) text */
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

/* worker-based token counter re-export */
export { default as useTokenCount } from './hooks/useTokenCount.js';

/* undo-delete helper remains unchanged */
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
