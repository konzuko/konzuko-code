/* -------------------------------------------------------------------------
   src/hooks.js

   - Maintains user settings in localStorage (useSettings, useFormData)
   - BFS directory scanning for dropped files
   - useFileDrop(onText, onImage) now supports text vs. images.
   - useMode, useTokenCount, useUndoableDelete remain unchanged.
---------------------------------------------------------------------------*/

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'preact/hooks';
import { encodingForModel } from 'js-tiktoken';
import { LOCALSTORAGE_DEBOUNCE } from './config.js';

// NEW: we now import isTextLike & isImage for gating
import { isTextLike, isImage } from './lib/fileTypeGuards.js';

/*────────────────────────────  Local-Storage w/ Debounce  ───────────────────
   Minimizes frequent writes by waiting <delay> ms before persisting to localStorage.
*/
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
        console.warn('localStorage error', err);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [key, value, delay]);

  return [value, setValue];
}

/*────────────────────────────  useSettings  ────────────────────────────────*/
export function useSettings() {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey       : '',
    model        : 'gpt-3.5-turbo',
    codeType     : 'javascript',
    showSettings : false,
  });
}

/*────────────────────────────  useFormData  ────────────────────────────────*/
export function useFormData() {
  return useDebouncedLocalStorage('konzuko-form-data', {
    developGoal         : '',
    developFeatures     : '',
    developReturnFormat :
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings     : '',
    developContext      : '',
    fixCode             : '',
    fixErrors           : '',
  });
}

/*────────────────────────────  BFS file scanning  ──────────────────────────
   gatherAllDroppedFiles:  handle directories + files from DataTransferItems
*/
async function readEntriesPromise(dirReader) {
  return new Promise((resolve, reject) => {
    dirReader.readEntries(resolve, reject);
  });
}

async function bfsTraverseWebkitEntry(rootEntry, outEntries = []) {
  const queue = [rootEntry];
  while (queue.length) {
    const entry = queue.shift();
    if (!entry) continue;
    if (entry.isFile) {
      outEntries.push(entry);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch = await readEntriesPromise(reader);
      while (batch.length > 0) {
        for (const e of batch) queue.push(e);
        batch = await readEntriesPromise(reader);
      }
    }
  }
  return outEntries;
}
function fileEntryToFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(
      file => {
        file.fullPath = entry.fullPath || file.name;
        resolve(file);
      },
      err => reject(err)
    );
  });
}

async function bfsTraverseFsHandle(rootHandle, outFiles = []) {
  const queue = [rootHandle];
  while (queue.length) {
    const handle = queue.shift();
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      file.fullPath = file.fullPath || file.name;
      outFiles.push(file);
    } else if (handle.kind === 'directory') {
      for await (const [, child] of handle.entries()) {
        queue.push(child);
      }
    }
  }
  return outFiles;
}

async function gatherAllDroppedFiles(dataTransferItems) {
  const allFiles = [];

  for (let i = 0; i < dataTransferItems.length; i++) {
    const item = dataTransferItems[i];
    if (item.kind !== 'file') continue;

    // 1) Attempt File System Access BFS
    if (item.getAsFileSystemHandle) {
      try {
        const handle = await item.getAsFileSystemHandle();
        const fsFiles = await bfsTraverseFsHandle(handle);
        allFiles.push(...fsFiles);
        continue;
      } catch (err) {
        console.warn('FS Access BFS error, fallback to webkit:', err);
        // fall through to webkit below
      }
    }

    // 2) Attempt webkitGetAsEntry BFS
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        const entries = await bfsTraverseWebkitEntry(entry);
        const realFiles = await Promise.all(entries.map(e => fileEntryToFile(e)));
        allFiles.push(...realFiles);
        continue;
      }
    }

    // 3) Fallback single file read
    const file = item.getAsFile();
    if (file) {
      file.fullPath = file.name;
      allFiles.push(file);
    }
  }

  return allFiles;
}

/**
 * useFileDrop:
 *   onText(text, file) → for any accepted “text-like” file
 *   onImage?(name, dataUrl) → if dropped file is an image
 */
export function useFileDrop(onText, onImage) {
  // Must prevent default to enable drop
  const dragOver = useCallback(e => {
    e.preventDefault();
  }, []);

  const drop = useCallback(async e => {
    e.preventDefault();
    const dtItems = e.dataTransfer.items;
    if (!dtItems) return;

    const files = await gatherAllDroppedFiles(dtItems);
    for (const f of files) {
      // 1) If image, produce thumbnail
      if (isImage(f)) {
        if (onImage) {
          const url = URL.createObjectURL(f);
          onImage(f.name, url);
        }
        continue;
      }
      // 2) If not text, skip
      if (!isTextLike(f)) continue;
      // 3) For text-likes, read as text
      await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => {
          onText(reader.result, f);
          resolve();
        };
        reader.readAsText(f);
      });
    }
  }, [onText, onImage]);

  return { dragOver, drop };
}

/*────────────────────────────  mode  ───────────────────────────────────────*/
export function useMode() {
  const ALLOWED = ['DEVELOP','COMMIT','CODE CHECK'];
  const stored  = localStorage.getItem('konzuko-mode');
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP';
  const [mode, _setMode] = useState(initial);

  const setMode = val => {
    if (!ALLOWED.includes(val)) {
      console.warn('Ignoring illegal mode:', val);
      return;
    }
    _setMode(val);
  };

  useEffect(() => {
    localStorage.setItem('konzuko-mode', mode);
  }, [mode]);

  return [mode, setMode];
}

/*────────────────────────────  token counting  ─────────────────────────────*/
export function useTokenCount(messages = [], model = 'gpt-3.5-turbo') {
  const [count, setCount] = useState(0);
  const encRef            = useRef({});

  const getEncoder = useCallback(async () => {
    if (!encRef.current[model]) {
      encRef.current[model] = await encodingForModel(model);
    }
    return encRef.current[model];
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!messages.length) {
        if (!cancelled) setCount(0);
        return;
      }
      try {
        const enc = await getEncoder();
        const total = messages.reduce((sum, m) => {
          const txt = Array.isArray(m.content)
            ? m.content.map(c => (c.type==='text' ? c.text : '')).join('')
            : String(m.content);
          return sum + enc.encode(txt).length;
        }, 0);
        if (!cancelled) setCount(total);
      }
      catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [messages, getEncoder]);

  return count;
}

/*──────────────────────────── Undoable Delete  ─────────────────────────────*/
export function useUndoableDelete(showToast) {
  return useCallback(async ({
    itemLabel,
    confirmMessage,
    deleteFn,
    undoFn,
    afterDelete
  }) => {
    if (!confirm(confirmMessage ||
      `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`))
    {
      return;
    }
    try {
      await deleteFn();
      afterDelete?.();
      // Provide 30s to 1min window to click “Undo”:
      showToast(`${itemLabel} deleted.`, () => undoFn());
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }, [showToast]);
}
