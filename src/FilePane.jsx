
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { asciiTree, dedupe } from './lib/textUtils.js';
import { isTextLike } from './lib/fileTypeGuards.js';

const FILE_LIMIT = 500;

async function scanDir(dirHandle, out, stats, path = '') {
  console.log('[FilePane] scanDir called for path:', path, 'handle:', dirHandle.name);
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      const fullPath = path ? `${path}/${name}` : name;
      console.log('[FilePane] scanDir processing entry:', fullPath, 'kind:', handle.kind);

      if (handle.kind === 'file') {
        if (out.length >= FILE_LIMIT) {
          stats.skipped++;
          console.log('[FilePane] scanDir file limit reached, skipping:', fullPath);
          continue;
        }
        const file = await handle.getFile();
        console.log('[FilePane] scanDir got file:', file.name, 'type:', file.type, 'size:', file.size);
        if (!isTextLike(file)) {
          stats.skipped++;
          console.log('[FilePane] scanDir file not text-like, skipping:', file.name);
          continue;
        }
        file.fullPath = fullPath;
        out.push(file);
        console.log('[FilePane] scanDir added file to batch:', file.fullPath);
      } else if (handle.kind === 'directory') { // Explicitly check for directory
        console.log('[FilePane] scanDir recursing into directory:', fullPath);
        await scanDir(handle, out, stats, fullPath);
      } else {
        console.warn('[FilePane] scanDir encountered unknown handle kind:', handle.kind, 'for', fullPath);
      }
    }
  } catch (scanError) {
    console.error('[FilePane] Error during scanDir for path:', path, scanError);
    stats.skipped++; // Or handle error more specifically
  }
}

function fileToText(f) {
  console.log('[FilePane] fileToText called for:', f.fullPath);
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      console.log('[FilePane] fileToText success for:', f.fullPath);
      res(String(r.result));
    };
    r.onerror = (err) => {
      console.error('[FilePane] fileToText error for:', f.fullPath, r.error);
      rej(r.error);
    };
    r.readAsText(f);
  });
}

export default function FilePane({
  form,
  setForm,
  onPasteImage, // re-added so that pasteImg can properly call it
  onSkip
}) {
  const [pending, setPending] = useState([]);
  const [adding, setAdding] = useState(false);

  const merge = useCallback(batch => {
    console.log('[FilePane] merge called with batch size:', batch.length);
    setPending(p => {
      const newPending = dedupe([...p, ...batch]).slice(0, FILE_LIMIT);
      console.log('[FilePane] merge new pending list size:', newPending.length);
      return newPending;
    });
  }, []);

  const appendContext = useCallback(async batch => {
    console.log('[FilePane] appendContext called with batch size:', batch.length);
    if (!batch.length) {
      console.log('[FilePane] appendContext: batch empty, returning.');
      return;
    }
    try {
      const tree = asciiTree(batch.map(f => f.fullPath));
      console.log('[FilePane] appendContext generated tree:', tree);
      const texts = await Promise.all(batch.map(fileToText));
      console.log('[FilePane] appendContext got texts, count:', texts.length);

      setForm(prev => {
        console.log('[FilePane] appendContext updating form.developContext. Previous length:', prev.developContext?.length || 0);
        const prevCtx = prev.developContext || '';
        const n = (prevCtx.match(/File structure \(added batch/gi) || []).length + 1;
        let block = `\n\n/* File structure (added batch ${n}):\n${tree}\n*/\n`;

        batch.forEach((f, i) => {
          block += `\n/* ${f.fullPath} */\n\n${texts[i]}\n`;
        });
        const newDevelopContext = prevCtx + block;
        console.log('[FilePane] appendContext new developContext length:', newDevelopContext.length);
        return { ...prev, developContext: newDevelopContext };
      });
      console.log('[FilePane] appendContext finished.');
    } catch (appendError) {
      console.error('[FilePane] Error in appendContext:', appendError);
      alert('Error processing files for context: ' + appendError.message);
    }
  }, [setForm]);

  const addFiles = useCallback(async () => {
    console.log('[FilePane] addFiles clicked');
    if (!window.showOpenFilePicker) {
      alert('showOpenFilePicker unsupported');
      return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      console.log('[FilePane] addFiles picker returned handles:', handles.length);
      const batch = [];
      let skipped = 0;

      for (const h of handles) {
        const f = await h.getFile();
        if (!isTextLike(f) || (batch.length + pending.length) >= FILE_LIMIT) {
          skipped++;
          console.log('[FilePane] addFiles skipping file:', f.name);
          continue;
        }
        f.fullPath = f.name; // For single files, fullPath is just the name
        batch.push(f);
        console.log('[FilePane] addFiles added to batch:', f.name);
      }
      await merge(batch);
      await appendContext(batch);
      if (skipped) {
        onSkip?.(skipped);
        console.log('[FilePane] addFiles skipped count:', skipped);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[FilePane] addFiles error:', err);
        alert('Failed to pick files: ' + err.message);
      } else {
        console.log('[FilePane] addFiles picker aborted by user.');
      }
    } finally {
      setAdding(false);
      console.log('[FilePane] addFiles finished.');
    }
  }, [pending.length, merge, appendContext, onSkip]);

  const addFolder = useCallback(async () => {
    console.log('[FilePane] addFolder clicked');
    if (!window.showDirectoryPicker) {
      alert('showDirectoryPicker unsupported');
      return;
    }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      console.log('[FilePane] addFolder picker returned dirHandle:', dirHandle.name);
      const batch = [];
      const stats = { skipped: 0 };
      await scanDir(dirHandle, batch, stats, dirHandle.name); // Pass initial path
      console.log('[FilePane] addFolder scanDir completed. Batch size:', batch.length, 'Skipped:', stats.skipped);
      await merge(batch);
      await appendContext(batch);
      if (stats.skipped) {
        onSkip?.(stats.skipped);
        console.log('[FilePane] addFolder skipped count:', stats.skipped);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[FilePane] addFolder error:', err);
        alert('Failed to pick folder: ' + err.message);
      } else {
        console.log('[FilePane] addFolder picker aborted by user.');
      }
    } finally {
      setAdding(false);
      console.log('[FilePane] addFolder finished.');
    }
  }, [merge, appendContext, onSkip]);

  const clearAll = useCallback(() => {
    console.log('[FilePane] clearAll clicked');
    if (!confirm('Remove all files & erase from prompt?')) return;
    setPending([]);
    setForm(p => ({ ...p, developContext: '' }));
    console.log('[FilePane] clearAll: cleared pending and developContext.');
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
            const url = URL.createObjectURL(blob);
            const revoke = () => URL.revokeObjectURL(url);
            onPasteImage?.('Clipboard Image', url, revoke);
            return;
          }
        }
      }
      alert('No image found in clipboard');
    } catch (err) {
      console.error(err);
      alert('Failed to read clipboard: ' + err.message);
    }
  }, [onPasteImage]);

  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {/File structure \(added batch/i.test(form.developContext) && (
        <div
          className="info-hint ok"
          style={{ marginBottom: '1rem' }}
        >
          Already appended file code. “Clear List” removes it.
        </div>
      )}

      {pending.length > 0 && (
        <div className="info-hint warn" style={{ marginBottom: '1rem' }}>
          {pending.length} / {FILE_LIMIT} files in memory.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button className="button" onClick={addFiles} disabled={adding}>
          + Add Files
        </button>
        <button className="button" onClick={addFolder} disabled={adding}>
          + Add Folder
        </button>
        <button
          className="button"
          onClick={clearAll}
          disabled={adding || !pending.length}
          style={pending.length ? { background: '#b71c1c', color: '#fff' } : {}}
        >
          Clear List
        </button>
      </div>

      <div style={{ textAlign: 'right', fontSize: '0.8rem', color: '#ccc' }}>
        <div><strong>Mac</strong>: Cmd+Ctrl+Shift+3/4</div>
        <div><strong>Win</strong>: Win+Shift+S</div>
        <div><strong>Linux</strong>: Flameshot</div>
        <button
          className="button"
          style={{ marginTop: 6, fontSize: '0.8rem' }}
          onClick={pasteImg}
        >
          Paste Image
        </button>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <strong>{pending.length} / {FILE_LIMIT} files selected</strong>
        {!!pending.length && (
          <ul className="file-pane-filelist">
            {pending.map((f, i) => (
              <li key={`${f.fullPath}-${f.size}`} style={{ position: 'relative' }}>
                {f.fullPath}
                <button
                  className="remove-file-btn"
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 4,
                    background: 'none',
                    border: 'none',
                    color: '#ff7373',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '1rem',
                    lineHeight: '1rem'
                  }}
                  title="Remove"
                  onClick={() => {
                    console.log('[FilePane] Removing file at index:', i, f.fullPath);
                    setPending(p => p.filter((_, j) => j !== i));
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}