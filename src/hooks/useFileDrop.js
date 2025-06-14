/* src/hooks/useFileDrop.js */
import { useCallback } from 'preact/hooks';
import { isTextLike, isImage } from '../lib/fileTypeGuards.js';

const MAX_TOTAL_DROPPED_FILES = 2000;

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
