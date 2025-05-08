/* -------------------------------------------------------------------------
   src/FilePane.jsx
   Enhances skip counts so that:
     - files beyond FILE_LIMIT are also counted as skipped
     - directory scanning accumulates in stats.skipped
---------------------------------------------------------------------------*/

import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { asciiTree, dedupe } from './lib/textUtils.js';
import { isTextLike }        from './lib/fileTypeGuards.js';

const FILE_LIMIT = 500;

/* Recursively scan a directory handle, counting stats.skipped if non-text
   or if out.length hits FILE_LIMIT.
*/
async function scanDir(dirHandle, out, stats, path = '') {
  for await (const [name, handle] of dirHandle.entries()) {
    const full = path ? `${path}/${name}` : name;

    if (handle.kind === 'file') {
      if (out.length >= FILE_LIMIT) {
        stats.skipped++;
        continue;
      }
      const file = await handle.getFile();
      if (!isTextLike(file)) {
        stats.skipped++;
        continue;
      }
      file.fullPath = full;
      out.push(file);
    } else {
      await scanDir(handle, out, stats, full);
    }
  }
}

/* Convert file to text */
function fileToText(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror= () => rej(r.error);
    r.readAsText(f);
  });
}

export default function FilePane({
  form,
  setForm,
  onPasteImage, // (name, url, revokeFn) => void
  onSkip        // (count: number) => void
}) {
  const [pending, setPending] = useState([]);
  const [adding,  setAdding ] = useState(false);

  const merge = useCallback(b => {
    setPending(p => dedupe([...p, ...b]).slice(0, FILE_LIMIT));
  }, []);

  const appendContext = useCallback(async batch => {
    if (!batch.length) return;
    const tree  = asciiTree(batch.map(f => f.fullPath));
    const texts = await Promise.all(batch.map(fileToText));

    setForm(prev => {
      const prevCtx = prev.developContext || '';
      const n = (prevCtx.match(/File structure \(added batch/gi) || []).length + 1;
      let block = `\n\n/* File structure (added batch ${n}):\n${tree}\n*/\n`;

      batch.forEach((f,i) => {
        block += `\n/* ${f.fullPath} */\n\n${texts[i]}\n`;
      });
      return { ...prev, developContext: prevCtx + block };
    });
  }, [setForm]);

  /* + Add Files */
  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      alert('showOpenFilePicker unsupported');
      return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      const batch   = [];
      let skipped   = 0;

      for (const h of handles) {
        const f = await h.getFile();

        if (!isTextLike(f)) {
          skipped++;
          continue;
        }
        if (batch.length + pending.length >= FILE_LIMIT) {
          skipped++;
          continue;
        }
        f.fullPath = f.name;
        batch.push(f);
      }
      await merge(batch);
      await appendContext(batch);

      if (skipped) {
        onSkip?.(skipped);
      }
    }
    finally { setAdding(false); }
  }, [pending.length, merge, appendContext, onSkip]);

  /* + Add Folder */
  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert('showDirectoryPicker unsupported');
      return;
    }
    try {
      setAdding(true);
      const dir   = await window.showDirectoryPicker();
      const batch = [];
      const stats = { skipped:0 };
      await scanDir(dir, batch, stats);
      await merge(batch);
      await appendContext(batch);

      if (stats.skipped) {
        onSkip?.(stats.skipped);
      }
    }
    finally { setAdding(false); }
  }, [merge, appendContext, onSkip]);

  const clearAll = useCallback(() => {
    if (!confirm('Remove all files & erase from prompt?')) return;
    setPending([]);
    setForm(p => ({ ...p, developContext: '' }));
  }, [setForm]);

  const pasteImg = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      alert('Clipboard API not supported');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        for (const t of it.types) {
          if (t.startsWith('image/')) {
            const blob = await it.getType(t);
            const url  = URL.createObjectURL(blob);
            const revoke = () => URL.revokeObjectURL(url);
            onPasteImage?.('Clipboard Image', url, revoke);
            return;
          }
        }
      }
      alert('No image found in clipboard');
    }
    catch (err) {
      console.error(err);
      alert('Failed to read clipboard: ' + err.message);
    }
  }, [onPasteImage]);

  /* UI */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {/File structure \(added batch/i.test(form.developContext) && (
        <div style={{
          marginBottom:'1rem', padding:'0.75rem 1rem',
          background:'#114411', color:'#ccffcc', borderRadius:4, fontSize:'0.9rem'
        }}>
          Already appended file code. “Clear List” removes it from memory & prompt.
        </div>
      )}

      {pending.length > 0 && (
        <div style={{
          marginBottom:'1rem', padding:'0.75rem 1rem',
          background:'#442200', color:'#ffe7cc', borderRadius:4, fontSize:'0.9rem'
        }}>
          {pending.length} / {FILE_LIMIT} files in memory.
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
        <div style={{ display:'flex', gap:8 }}>
          <button className="button" onClick={addFiles} disabled={adding}>
            + Add Files
          </button>
          <button className="button" onClick={addFolder} disabled={adding}>
            + Add Folder
          </button>
          <button
            className="button"
            onClick={clearAll}
            disabled={adding && !pending.length}
            style={pending.length ? { background:'#b71c1c', color:'#fff' } : {}}
          >
            Clear List
          </button>
        </div>

        <div style={{ textAlign:'right', fontSize:'0.8rem', color:'#ccc' }}>
          <div><strong>Mac</strong>: Cmd+Ctrl+Shift+3/4</div>
          <div><strong>Win</strong>: Win+Shift+S</div>
          <div><strong>Linux</strong>: Flameshot</div>
          <button
            className="button"
            style={{ marginTop:6, fontSize:'0.8rem' }}
            onClick={pasteImg}
          >
            Paste Image
          </button>
        </div>
      </div>

      <div style={{ marginTop:'1rem' }}>
        <strong>{pending.length} / {FILE_LIMIT} files selected</strong>
        {pending.length > 0 && (
          <ul className="file-pane-filelist">
            {pending.map(f => (
              <li key={`${f.fullPath}-${f.size}`}>{f.fullPath}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
