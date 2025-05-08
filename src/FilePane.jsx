
/* -------------------------------------------------------------------------
   src/FilePane.jsx
   Manages “Project Files” region with:
   - “+ Add Files”
   - “+ Add Folder”
   - scanning directories
   - appending code to developContext

   CHANGES:
   - We skip non-text with isTextLike()
   - If needed, show skip counts in an alert
---------------------------------------------------------------------------*/

import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';

import { asciiTree, dedupe }     from './lib/textUtils.js';
import { isTextLike }            from './lib/fileTypeGuards.js';

const FILE_LIMIT = 500;

/* Recursively scan a directory handle (File System Access API) */
async function scanDir(dirHandle, out, remaining, path = '') {
  if (remaining <= 0) return;
  for await (const [name, handle] of dirHandle.entries()) {
    const full = path ? `${path}/${name}` : name;
    if (handle.kind === 'file') {
      if (out.length >= FILE_LIMIT) return;
      const file = await handle.getFile();
      if (!isTextLike(file)) continue;  // skip non-text
      file.fullPath = full;
      out.push(file);
    }
    else if (handle.kind === 'directory') {
      await scanDir(handle, out, FILE_LIMIT - out.length, full);
      if (out.length >= FILE_LIMIT) return;
    }
  }
}

/* Convert a File to text (async) */
function fileToText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export default function FilePane({
  form,
  setForm,
  onPasteImage // (name, dataUrl) => void
}) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [adding, setAdding]             = useState(false);

  // Merge a new batch of files into pending
  const mergeBatch = useCallback((batch) => {
    setPendingFiles(prev => dedupe([...prev, ...batch]).slice(0, FILE_LIMIT));
  }, []);

  // Actually append batch code to developContext
  const appendBatchToContext = useCallback(async (batch) => {
    if (!batch.length) return;

    const tree  = asciiTree(batch.map(f => f.fullPath));
    const texts = await Promise.all(batch.map(fileToText));

    setForm(prev => {
      const prevCtx  = prev.developContext || '';
      const batchNum =
        (prevCtx.match(/File structure \(added batch/gi) || []).length + 1;

      let block = `\n\n/* File structure (added batch ${batchNum}):\n${tree}\n*/\n`;
      for (let i = 0; i < batch.length; i++) {
        block += `\n/* ${batch[i].fullPath} */\n\n${texts[i]}\n`;
      }
      return { ...prev, developContext: prevCtx + block };
    });
  }, [setForm]);

  /* “+ Add Files” */
  const handleAddFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      alert('Your browser does not support showOpenFilePicker.');
      return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      const batch   = [];
      let skipped   = 0;

      for (const h of handles) {
        if (batch.length + pendingFiles.length >= FILE_LIMIT) break;
        const f = await h.getFile();
        if (!isTextLike(f)) { skipped++; continue; }
        f.fullPath = f.name;
        batch.push(f);
      }
      await mergeBatch(batch);
      await appendBatchToContext(batch);

      if (skipped) {
        alert(`${skipped} file${skipped>1?'s':''} were skipped. `
            + `If needed, drag them in individually.`);
      }
    }
    catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('AddFiles error', err);
      }
    } finally {
      setAdding(false);
    }
  }, [mergeBatch, appendBatchToContext, pendingFiles.length]);

  /* “+ Add Folder” */
  const handleAddFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support showDirectoryPicker.');
      return;
    }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      const batch     = [];
      await scanDir(dirHandle, batch, FILE_LIMIT - pendingFiles.length);
      await mergeBatch(batch);
      await appendBatchToContext(batch);

      if (!batch.length) {
        alert('No valid text/code files found in that folder.');
      }
    }
    catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('AddFolder error', err);
      }
    } finally {
      setAdding(false);
    }
  }, [mergeBatch, appendBatchToContext, pendingFiles.length]);

  /* Clear everything & remove from the prompt. */
  const handleClearAll = useCallback(() => {
    if (!confirm('Remove all files from the list and also erase from the prompt?'))
      return;
    setPendingFiles([]);
    setForm(prev => ({ ...prev, developContext: '' }));
  }, [setForm]);

  /* For “Paste Image” button (unchanged from original) */
  const handlePasteClipboard = useCallback(async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      alert('Clipboard API not supported');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      let found   = false;
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const url  = URL.createObjectURL(blob);
            onPasteImage?.('Clipboard Image', url);
            found = true;
          }
        }
      }
      if (!found) {
        alert('No image found in clipboard');
      }
    }
    catch (err) {
      console.error(err);
      alert('Failed to read clipboard: ' + err.message);
    }
  }, [onPasteImage]);

  /* ───────────────────────────────────────── Render ───────────────────────────────────── */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {/File structure \(added batch/i.test(form.developContext) && (
        <div style={{
          marginBottom: '1rem',
          padding      : '0.75rem 1rem',
          background   : '#114411',
          color        : '#ccffcc',
          borderRadius : 4,
          fontSize     : '0.9rem',
        }}>
          Already appended file code to your prompt. “Clear List” removes them
          from memory and also erases them from the prompt.
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding      : '0.75rem 1rem',
          background   : '#442200',
          color        : '#ffe7cc',
          borderRadius : 4,
          fontSize     : '0.9rem',
        }}>
          {pendingFiles.length} / {FILE_LIMIT} files in memory. Clear List wipes
          them from the prompt.
        </div>
      )}

      <div style={{
        display       : 'flex',
        justifyContent: 'space-between',
        alignItems    : 'flex-start',
        gap           : 8
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button" onClick={handleAddFiles} disabled={adding}>
            + Add Files
          </button>
          <button className="button" onClick={handleAddFolder} disabled={adding}>
            + Add Folder
          </button>
          <button
            className="button"
            onClick={handleClearAll}
            disabled={adding && pendingFiles.length === 0}
            style={pendingFiles.length
              ? { background: '#b71c1c', color: '#fff', borderColor: '#7f0000' }
              : {}
            }
          >
            Clear List
          </button>
        </div>

        <div style={{
          textAlign : 'right',
          fontSize  : '0.8rem',
          lineHeight: 1.2,
          color     : '#ccc'
        }}>
          <div><strong>Mac</strong>: Cmd+Ctrl+Shift+3 or 4 → copies screenshot</div>
          <div><strong>Win</strong>: Win+Shift+S → copies screenshot</div>
          <div><strong>Linux</strong>: PrtSc w/ Flameshot → to clipboard</div>
          <button
            className="button"
            style={{ marginTop: '6px', fontSize: '0.8rem' }}
            onClick={handlePasteClipboard}
          >
            Paste Image
          </button>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <strong>
          {pendingFiles.length} / {FILE_LIMIT} files selected
        </strong>

        {pendingFiles.length > 0 && (
          <ul className="file-pane-filelist">
            {pendingFiles.map(f => (
              <li key={f.fullPath}>{f.fullPath}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
