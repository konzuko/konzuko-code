import { useState } from 'preact/hooks';

/** Hard limit on total file count. */
const FILE_LIMIT = 500;

/**
 * Recursively scans a directory handle, pushing File objects (with .fullPath)
 * into 'out'. Stops if we reach limit.
 */
async function scanDir(dirHandle, out, limit, path = '') {
  for await (const [name, handle] of dirHandle.entries()) {
    const full = path ? `${path}/${name}` : name;
    if (handle.kind === 'file') {
      if (out.length >= limit) return;
      const file = await handle.getFile();
      file.fullPath = full;
      out.push(file);
    } else if (handle.kind === 'directory') {
      await scanDir(handle, out, limit, full);
      if (out.length >= limit) return;
    }
  }
}

/**
 * Builds an ASCII tree from an array of file paths,
 * e.g. "src/App.jsx" => "└─ src\n   └─ App.jsx"
 */
function asciiTree(paths) {
  const root = {};
  paths.forEach((p) => {
    p.split('/').reduce((acc, part, i, arr) => {
      acc[part] ||= (i === arr.length - 1 ? null : {});
      return acc[part];
    }, root);
  });
  return renderTree(root, '');
}

function renderTree(node, prefix) {
  if (!node) return '';
  const keys = Object.keys(node);
  return keys.map((k, i) => {
    const isLast = i === keys.length - 1;
    const line   = `${prefix}${isLast ? '└─ ' : '├─ '}${k}`;
    const kid    = renderTree(node[k], prefix + (isLast ? '   ' : '│  '));
    return kid ? `${line}\n${kid}` : line;
  }).join('\n');
}

/** Read a File as text (returns a Promise<string>). */
function fileToText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}

/** Deduplicate an array of Files by file.fullPath, preserving order. */
function dedupeFiles(files) {
  const seen = new Set();
  return files.filter((f) => !seen.has(f.fullPath) && seen.add(f.fullPath));
}

export default function FilePane({ form, setForm }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [adding, setAdding] = useState(false); // simple "busy" state

  /**
   * Merges a new batch of files into the existing pendingFiles array,
   * respecting the 500-file cap.
   */
  async function mergeBatch(newBatch) {
    const combined = [...pendingFiles, ...newBatch];
    const unique   = dedupeFiles(combined).slice(0, FILE_LIMIT);
    setPendingFiles(unique);
  }

  /**
   * For each incoming batch:
   * 1) Build an ASCII tree for that batch only
   * 2) Read each file's text
   * 3) Append tree + the file contents to developContext
   *    (keeps full code in your prompt so LLms can read it)
   */
  async function appendBatchToContext(batch) {
    if (!batch.length) return;
    // 1) Build ASCII tree
    const tree = asciiTree(batch.map(f => f.fullPath));

    // 2) Read all file contents
    const texts = await Promise.all(batch.map(fileToText));

    // 3) Compose a block of text that starts with a comment for the ASCII tree,
    //    then each file content is inserted in a comment block.
    const batchCount = (form.developContext.match(/File structure \(added batch/g) || []).length + 1;
    let block = `\n\n/* File structure (added batch ${batchCount}):\n${tree}\n*/\n`;

    batch.forEach((file, i) => {
      block += `\n/* ${file.fullPath} */\n\n${texts[i]}\n`;
    });

    // 4) Append to developContext
    setForm(f => ({
      ...f,
      developContext: f.developContext + block
    }));
  }

  /** Handler: + Add Files */
  async function handleAddFiles() {
    if (!window.showOpenFilePicker) {
      alert('Your browser lacks showOpenFilePicker (Chrome 86+, Edge 86+).');
      return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      if (!handles.length) return;

      const batch = [];
      for (const h of handles) {
        if (pendingFiles.length + batch.length >= FILE_LIMIT) break;
        const f = await h.getFile();
        f.fullPath = f.name; // no subdir for single-file picks
        batch.push(f);
      }
      await mergeBatch(batch);
      await appendBatchToContext(batch);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('AddFiles error:', err);
    } finally {
      setAdding(false);
    }
  }

  /** Handler: + Add Folder */
  async function handleAddFolder() {
    if (!window.showDirectoryPicker) {
      alert('Your browser lacks showDirectoryPicker (Chrome 86+).');
      return;
    }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      const batch = [];
      await scanDir(dirHandle, batch, FILE_LIMIT - pendingFiles.length);
      await mergeBatch(batch);
      await appendBatchToContext(batch);
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('AddFolder error:', err);
    } finally {
      setAdding(false);
    }
  }

  /** Handler: clearing the in-memory list. Does not remove from developContext. */
  function handleClearAll() {
    setPendingFiles([]);
  }

  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      <button
        className="button"
        onClick={handleAddFiles}
        disabled={adding}
      >
        + Add Files
      </button>
      <button
        className="button"
        onClick={handleAddFolder}
        style={{ marginLeft: 8 }}
        disabled={adding}
      >
        + Add Folder
      </button>
      <button
        className="button"
        onClick={handleClearAll}
        style={{ marginLeft: 8 }}
        disabled={adding}
      >
        Clear List
      </button>

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