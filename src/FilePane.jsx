
import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants & helpers                                                      */
/* ────────────────────────────────────────────────────────────────────────── */
const FILE_LIMIT = 500;

/* Recursively scan directory handles (File-System-Access API) */
async function scanDir(dirHandle, out, remaining, path = '') {
  if (remaining <= 0) return;
  for await (const [name, handle] of dirHandle.entries()) {
    const full = path ? `${path}/${name}` : name;

    if (handle.kind === 'file') {
      if (out.length >= FILE_LIMIT) return;
      const file = await handle.getFile();
      file.fullPath = full;
      out.push(file);
    } else if (handle.kind === 'directory') {
      await scanDir(handle, out, FILE_LIMIT - out.length, full);
      if (out.length >= FILE_LIMIT) return;
    }
  }
}

/* Build ASCII tree */
function asciiTree(paths) {
  const root = {};
  paths.forEach((p) =>
    p.split('/').reduce((node, part, i, arr) => {
      node[part] ??= i === arr.length - 1 ? null : {};
      return node[part];
    }, root)
  );
  return renderTree(root, '');
}
function renderTree(node, prefix) {
  if (!node) return '';
  const keys = Object.keys(node).sort();
  return keys
    .map((k, i) => {
      const isLast = i === keys.length - 1;
      const line = `${prefix}${isLast ? '└─ ' : '├─ '}${k}`;
      const kids = renderTree(node[k], prefix + (isLast ? '   ' : '│  '));
      return kids ? `${line}\n${kids}` : line;
    })
    .join('\n');
}

/* File → text promise */
const fileToText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });

/* Dedupe by fullPath */
function dedupe(files) {
  const seen = new Set();
  return files.filter((f) => {
    if (seen.has(f.fullPath)) return false;
    seen.add(f.fullPath);
    return true;
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                */
/* ────────────────────────────────────────────────────────────────────────── */
export default function FilePane({ form, setForm }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [adding, setAdding]             = useState(false);

  /* Is there already persisted file code in developContext? */
  const hasPersisted = /File structure \(added batch/i.test(
    form.developContext || ''
  );

  /* ─── Callbacks ──────────────────────────────────────────────────────── */
  const mergeBatch = useCallback((batch) => {
    setPendingFiles((prev) =>
      dedupe([...prev, ...batch]).slice(0, FILE_LIMIT)
    );
  }, []);

  const appendBatchToContext = useCallback(
    async (batch) => {
      if (!batch.length) return;

      const tree  = asciiTree(batch.map((f) => f.fullPath));
      const texts = await Promise.all(batch.map(fileToText));

      setForm((prev) => {
        const prevCtx   = prev.developContext || '';
        const batchNum  =
          (prevCtx.match(/File structure \(added batch/gi) || []).length + 1;

        let block = `\n\n/* File structure (added batch ${batchNum}):\n${tree}\n*/\n`;
        batch.forEach((file, idx) => {
          block += `\n/* ${file.fullPath} */\n\n${texts[idx]}\n`;
        });

        return { ...prev, developContext: prevCtx + block };
      });
    },
    [setForm]
  );

  const handleAddFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      alert('Your browser lacks showOpenFilePicker (Chrome 86+, Edge 86+).');
      return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      const batch   = [];
      for (const h of handles) {
        if (batch.length + pendingFiles.length >= FILE_LIMIT) break;
        const f = await h.getFile();
        f.fullPath = f.name;
        batch.push(f);
      }
      await mergeBatch(batch);
      await appendBatchToContext(batch);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('AddFiles error', err);
    } finally {
      setAdding(false);
    }
  }, [mergeBatch, appendBatchToContext, pendingFiles.length]);

  const handleAddFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser lacks showDirectoryPicker (Chrome 86+).');
      return;
    }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      const batch     = [];
      await scanDir(dirHandle, batch, FILE_LIMIT - pendingFiles.length);
      await mergeBatch(batch);
      await appendBatchToContext(batch);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('AddFolder error', err);
    } finally {
      setAdding(false);
    }
  }, [mergeBatch, appendBatchToContext, pendingFiles.length]);

  /* NEW: also clear developContext so localStorage is wiped */
  const handleClearAll = useCallback(() => {
    if (
      !confirm(
        'Remove all files from the list and erase their code from the prompt?'
      )
    )
      return;

    setPendingFiles([]);
    setForm((prev) => ({ ...prev, developContext: '' }));
  }, [setForm]);

  /* ─── UI ─────────────────────────────────────────────────────────────── */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {hasPersisted && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: '#114411',
            color: '#ccffcc',
            borderRadius: 4,
            fontSize: '0.9rem',
          }}
        >
          Your prompt already contains persisted file code. Use <em>Clear
          List</em> if you’d like to wipe it and start fresh.
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: '#442200',
            color: '#ffe7cc',
            borderRadius: 4,
            fontSize: '0.9rem',
          }}
        >
          {pendingFiles.length} / {FILE_LIMIT} files in memory. “Clear List”
          removes them and erases them from your prompt.
        </div>
      )}

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
          style={
            pendingFiles.length
              ? { background: '#b71c1c', color: '#fff', borderColor: '#7f0000' }
              : {}
          }
        >
          Clear List
        </button>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <strong>
          {pendingFiles.length} / {FILE_LIMIT} files selected
        </strong>
        {pendingFiles.length > 0 && (
          <ul className="file-pane-filelist">
            {pendingFiles.map((f) => (
              <li key={f.fullPath}>{f.fullPath}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}