/* src/FilePane.jsx
   ------------------------------------------------------------
   Handles:
   • Text/code file selection (+Add Files)
   • Folder scanning with FILTER step (+Add Folder)
   • Image selection, compression (1024px WebP), and Supabase upload (+Add Images)
   • Image paste from clipboard, compression, and Supabase upload (Paste Image)
   • PDF selection and direct browser upload to OpenAI Files API using user's key (+Add PDF)
------------------------------------------------------------*/
import { useState, useCallback, useEffect } from 'preact/hooks';

import { loadRoot, saveRoot, clearRoot, getFullPath } from './lib/fsRoot.js';
import {
  isTextLike,
  MAX_TEXT_FILE_SIZE,
  MAX_CHAR_LEN
} from './lib/fileTypeGuards.js';
import { checksum32 }             from './lib/checksum.js';
import Toast                      from './components/Toast.jsx';
import { compressImageToWebP }    from './lib/imageUtils.js';
import { supabase }               from './lib/supabase.js';

const FILE_LIMIT = 500;

/* ─────────── misc helpers ─────────── */
const NOTE =
  'checksum suffix added because this file is named exactly the same as another, yet its content is different';

function hex6(ck) {
  return ck.toString(16).padStart(8, '0').slice(0, 6);
}

function withHash(path, ck, taken) {
  const m = path.match(/^(.*?)(\.[^.]+)?$/);
  const stem = m[1], ext = m[2] || '';
  let name = `${stem}.${hex6(ck)}${ext}`;
  if (!taken.has(name)) return name;
  let i = 1;
  while (taken.has(`${name}(${i})`)) i++;
  return `${name}(${i})`;
}

function mergeFiles(existing = [], incoming = []) {
  const taken = new Map();  // fullPath → Set<checksum>
  const out   = [...existing];

  existing.forEach(f => {
    const s = taken.get(f.fullPath) || new Set();
    s.add(f.checksum);
    taken.set(f.fullPath, s);
  });

  for (const f of incoming) {
    if (out.length >= FILE_LIMIT) break;

    const s = taken.get(f.fullPath);
    if (!s) {
      taken.set(f.fullPath, new Set([f.checksum]));
      out.push(f);
      continue;
    }
    if (s.has(f.checksum)) {
      out.push(f);
      continue;
    }
    const newPath = withHash(f.fullPath, f.checksum, taken);
    taken.set(newPath, new Set([f.checksum]));
    out.push({ ...f, fullPath: newPath, note: NOTE });
  }
  return out;
}

function isIncluded(fullPath, filterMap) {
  const parts = fullPath.split('/');
  if (parts.length === 1) return filterMap[parts[0]] !== false;
  for (const dir of parts.slice(0, -1)) {
    if (filterMap[dir] === false) return false;
  }
  return true;
}

/* =========================================================
   COMPONENT
========================================================= */
export default function FilePane({
  files             = [],
  onFilesChange,
  onSkip,

  onAddImage,
  onAddPDF,
  settings
}) {
  const [adding, setAdding]           = useState(false);
  const [projectRoot, setProjectRoot] = useState(null);

  const [entryFilter, setEntryFilter] = useState({});
  const [step, setStep]               = useState('FILTER');
  const [topEntries, setTopEntries]   = useState([]);

  useEffect(() => {
    let live = true;
    loadRoot().then(h => live && setProjectRoot(h)).catch(() => {});
    return () => { live = false; };
  }, []);

  const clearAll = () => {
    if (!files.length && !projectRoot && topEntries.length === 0 && Object.keys(entryFilter).length === 0) return;
    if (!confirm('Remove all selected files and clear project root?')) return;
    clearRoot();
    setProjectRoot(null);
    setEntryFilter({});
    setTopEntries([]);
    setStep('FILTER');
    onFilesChange([]);
  };

  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        Toast('File picker is not supported in this browser.', 4000);
        return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      const batch   = [];
      let skipped   = 0;

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) { skipped++; continue; }
        const f = await h.getFile();
        if (f.size > MAX_TEXT_FILE_SIZE) { skipped++; continue; }
        if (!isTextLike(f))              { skipped++; continue; }

        const text = await f.text();
        if (text.length > MAX_CHAR_LEN)  { skipped++; continue; }

        const ck = checksum32(text);
        const { fullPath, insideProject } = await getFullPath(h, projectRoot);
        batch.push({ fullPath, text, checksum: ck, insideProject });
      }

      if (skipped) onSkip?.(skipped);
      const merged = mergeFiles(files, batch);
      onFilesChange(merged);
      setStep('FILES');
    } catch (err) {
      if (err.name !== 'AbortError') Toast('File pick error: ' + err.message, 4000);
    } finally {
      setAdding(false);
    }
  }, [files, onFilesChange, onSkip, projectRoot]);

  async function scanDir(handle, out, stats, root) {
    for await (const [, h] of handle.entries()) {
      if (out.length >= FILE_LIMIT) { stats.limit++; continue; }
      try {
        if (h.kind === 'file') {
          const f = await h.getFile();
          if (f.size > MAX_TEXT_FILE_SIZE) { stats.bigSize++; continue; }
          if (!isTextLike(f))              { stats.binary++;  continue; }
          const text = await f.text();
          if (text.length > MAX_CHAR_LEN)  { stats.bigChar++; continue; }

          const ck = checksum32(text);
          const { fullPath, insideProject } = await getFullPath(h, root);
          out.push({ fullPath, text, checksum: ck, insideProject });
        } else if (h.kind === 'directory') {
          await scanDir(h, out, stats, root);
        }
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          stats.perm++;
        } else {
          stats.fsErr++;
          console.warn(`FS error scanning ${h.name}:`, err);
        }
      }
    }
  }

  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
        Toast('Directory picker is not supported in this browser.', 4000);
        return;
    }
    try {
      setAdding(true);
      setEntryFilter({});
      setTopEntries([]);
      setStep('FILTER');

      const dirHandle = await window.showDirectoryPicker();
      const tops = [];
      for await (const [name, h] of dirHandle.entries()) {
        tops.push({ name, kind: h.kind });
      }
      setTopEntries(tops);

      const batch = [];
      const stats = { bigSize:0, bigChar:0, binary:0, limit:0, perm:0, fsErr:0 };
      await scanDir(dirHandle, batch, stats, dirHandle);
      await saveRoot(dirHandle);
      setProjectRoot(dirHandle);

      const freshMap = {};
      tops.forEach(e => { freshMap[e.name] = true; });
      setEntryFilter(freshMap);

      const merged   = mergeFiles(files, batch);
      const filtered = merged.filter(f => isIncluded(f.fullPath, freshMap));
      onFilesChange(filtered);

      const skipped = stats.bigSize + stats.bigChar + stats.binary +
                      stats.limit   + stats.perm    + stats.fsErr;
      if (skipped) {
        const parts = [];
        if (stats.bigSize) parts.push(`${stats.bigSize} >300 KB`);
        if (stats.bigChar) parts.push(`${stats.bigChar} >50 k chars`);
        if (stats.binary)  parts.push(`${stats.binary} binary`);
        if (stats.limit)   parts.push(`${stats.limit} over limit`);
        if (stats.perm)    parts.push(`${stats.perm} permission denied`);
        if (stats.fsErr)   parts.push(`${stats.fsErr} fs errors`);
        Toast(`Skipped ${skipped} file${skipped>1?'s':''} – ${parts.join(', ')}`, 5000);
      }
    } catch (err) {
      if (err.name !== 'AbortError') Toast('Folder pick error: ' + err.message, 4000);
    } finally {
      setAdding(false);
    }
  }, [files, onFilesChange]);

  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        Toast('File picker is not supported in this browser.', 4000);
        return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{
          description: 'Images',
          accept: {
            'image/png': ['.png'],
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/webp': ['.webp'],
            'image/gif': ['.gif'],
            'image/bmp': ['.bmp'],
            'image/tiff': ['.tif', '.tiff'],
            'image/heic': ['.heic', '.heif'],
          }
        }]
      });

      for (const h of handles) {
        const file = await h.getFile();
        const blob = await compressImageToWebP(file, 1024, 0.85);

        const path = `images/${crypto.randomUUID()}.webp`;
        const { error: upErr } = await supabase
          .storage.from('images')
          .upload(path, blob, { contentType: 'image/webp', upsert: false });
        if (upErr) throw upErr;

        const { data: pub, error: pubErr } =
          supabase.storage.from('images').getPublicUrl(path);
        if (pubErr) throw pubErr;

        onAddImage?.({ name: file.name, url: pub.publicUrl });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error("Add images error:", err);
        Toast('Add images error: ' + err.message, 4000);
      }
    } finally {
      setAdding(false);
    }
  }, [onAddImage]);

  const handlePasteImage = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      Toast('Paste requires a secure context (HTTPS) and compatible browser.', 4000);
      return;
    }
    try {
      setAdding(true);
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const mime = it.types.find(t => t.startsWith('image/'));
        if (!mime) continue;

        const raw  = await it.getType(mime);
        const blob = await compressImageToWebP(raw, 1024, 0.85);
        const name = `clipboard_${Date.now()}.webp`;
        const path = `images/${crypto.randomUUID()}.webp`;

        const { error: upErr } = await supabase
          .storage.from('images')
          .upload(path, blob, { contentType: 'image/webp', upsert: false });
        if (upErr) throw upErr;

        const { data: pub, error: pubErr } =
          supabase.storage.from('images').getPublicUrl(path);
        if (pubErr) throw pubErr;

        onAddImage?.({ name, url: pub.publicUrl });
        Toast('Image pasted & added', 1500);
        break;
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        Toast('Browser denied clipboard access. Please check permissions.', 4000);
      } else {
        console.error("Paste image error:", err);
        Toast('Paste image failed: ' + err.message, 4000);
      }
    } finally {
      setAdding(false);
    }
  }, [onAddImage]);

  const handleAddPDF = useCallback(async () => {
    if (!settings || !settings.apiKey) {
      Toast('OpenAI API Key not set. Please set it in the application settings.', 4000);
      return;
    }
    if (!window.showOpenFilePicker) {
      Toast('File picker is not supported in this browser.', 4000);
      return;
    }
    // Model compatibility check (optional, can be enhanced)
    const compatibleModels = ['o1', 'o4-mini', 'o3', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.5-preview-2025-02-27', 'o4-mini-2025-04-16', 'o3-2025-04-16'];
    if (settings && !compatibleModels.some(m => settings.model.startsWith(m))) {
        Toast(`Model '${settings.model}' may not fully support PDF uploads. Consider a vision-capable model.`, 5000);
    }

    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });

      for (const h of handles) {
        const file = await h.getFile();
        const formData = new FormData();
        formData.append('purpose', 'user_data');
        formData.append('file', file, file.name);

        const response = await fetch('https://api.openai.com/v1/files', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${settings.apiKey}` },
          body: formData
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error?.message || `OpenAI API Error: ${response.status}`);
        }
        onAddPDF?.({ name: file.name, fileId: responseData.id });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        Toast('PDF upload error: ' + err.message, 4000);
        console.error("PDF Upload Error:", err);
      }
    } finally {
      setAdding(false);
    }
  }, [onAddPDF, settings]);

  useEffect(() => {
    if (step !== 'FILES' || !topEntries.length) return;
    const newList = files.filter(f => isIncluded(f.fullPath, entryFilter));
    if (newList.length === files.length && files.every((f, i) => newList[i] && newList[i].fullPath === f.fullPath)) return;
    
    const excluded = files.length - newList.length;
    onFilesChange(newList);
    if (excluded > 0) {
        Toast(`Excluded ${excluded} item${excluded > 1 ? 's' : ''} by filter`, 4000);
    }
  }, [entryFilter, files, step, onFilesChange, topEntries.length]);

  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>
      {projectRoot && (
        <div style={{ marginBottom: 8, fontSize: '0.85rem', opacity: 0.8 }}>
          Root: <code>{projectRoot.name}</code>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className="button" onClick={addFiles}        disabled={adding}>+ Add Files</button>
        <button className="button" onClick={addFolder}       disabled={adding}>+ Add Folder</button>
        <button className="button" onClick={handleAddImages} disabled={adding}>+ Add Images</button>
        <button className="button" onClick={handlePasteImage} disabled={adding}>Paste Image</button>
        <button className="button" onClick={handleAddPDF}    disabled={adding}>+ Add PDF</button>
        <button
          className="button"
          onClick={clearAll}
          disabled={adding}
          style={files.length || projectRoot || topEntries.length || Object.keys(entryFilter).length ? { background: '#b71c1c', color: '#fff' } : {}}
        >
          Clear List
        </button>
      </div>
      {step === 'FILTER' && topEntries.length > 0 && (
        <div>
          <h3>Select entries to include from '{projectRoot?.name || 'selected folder'}'</h3>
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '4px 0',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            marginBottom: '8px'
          }}>
            {topEntries.map(({ name, kind }) => (
              <label key={name} style={{ display: 'block', margin: '4px 8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={entryFilter[name] !== false}
                  onChange={e => setEntryFilter(m => ({ ...m, [name]: e.target.checked }))}
                  style={{ marginRight: '8px' }}
                />
                {kind === 'directory' ? '📁' : '📄'} <strong>{name}</strong>
              </label>
            ))}
          </div>
          <button className="button" style={{ marginTop: 8 }} onClick={() => setStep('FILES')}>
            Apply Filter & Continue
          </button>
        </div>
      )}
      {step === 'FILES' && (
        <>
          <strong>{files.length} / {FILE_LIMIT} text files selected</strong>
          {!!files.length && (
            <ul className="file-pane-filelist">
              {files.map((f, i) => (
                <li key={`${f.fullPath}-${i}-${f.checksum}`} style={{ position: 'relative' }}>
                  {f.note
                    ? <span title={f.note}>{f.fullPath}</span>
                    : f.insideProject
                      ? f.fullPath
                      : <span title="This file is outside the selected project root. Its path is relative to its original location.">⚠ {f.fullPath}</span>
                  }
                  <button
                    className="remove-file-btn"
                    style={{
                      position: 'absolute', top: 2, right: 4,
                      background: 'none', border: 'none',
                      color: '#ff7373', cursor: 'pointer',
                      fontWeight: 'bold', fontSize: '1rem',
                      padding: '0 4px', lineHeight: '1'
                    }}
                    title="Remove"
                    onClick={() => onFilesChange(files.filter((_, j) => j !== i))}
                  >×</button>
                </li>
              ))}
            </ul>
          )}
          {files.length === 0 && step === 'FILES' && !topEntries.length && (
            <p style={{ color: 'var(--text-secondary)' }}>No text files added yet. Use the buttons above.</p>
          )}
           {files.length === 0 && step === 'FILES' && topEntries.length > 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>No text files matched the filter or found in the folder.</p>
          )}
        </>
      )}
    </div>
  );
}