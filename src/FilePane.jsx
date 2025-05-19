/* src/FilePane.jsx
   ------------------------------------------------------------
   Handles:
   • Text/code file selection (+Add Files)
   • Folder scanning with FILTER step (+Add Folder)
   • Image selection, compression (1024px WebP), and Supabase upload (+Add Images)
   • Image paste from clipboard, compression, and Supabase upload (Paste Image)
   • PDF selection and direct browser upload to Gemini Files API using user's key (+Add PDF)
------------------------------------------------------------*/
import { useState, useCallback, useEffect } from 'preact/hooks';
import { GoogleGenAI } from "@google/genai";

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
      // If file with same path and checksum exists, decide whether to add or skip.
      // Current logic might add duplicates if checksum matches but object identity is different.
      // For simplicity, let's assume if path & checksum match, it's effectively the same.
      // To avoid duplicates if objects are different but content is same:
      // if (!out.find(existingFile => existingFile.fullPath === f.fullPath && existingFile.checksum === f.checksum)) {
      //   out.push(f);
      // }
      // For now, let's keep the original behavior which might add if object is new, even if content is same.
      // This part might need refinement based on desired behavior for identical content from different selections.
      // A simple way to avoid exact duplicates by object reference and content:
      const alreadyExists = out.some(ef => ef.fullPath === f.fullPath && ef.checksum === f.checksum);
      if (!alreadyExists) {
          out.push(f);
      }
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
        batch.push({ fullPath, text, checksum: ck, insideProject, name: f.name });
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

  async function scanDir(handle, out, stats, root, currentPath = '') {
    for await (const [name, h] of handle.entries()) {
      if (out.length >= FILE_LIMIT) { stats.limit++; continue; }
      const entryPath = currentPath ? `${currentPath}/${name}` : name;
      try {
        if (h.kind === 'file') {
          const f = await h.getFile();
          if (f.size > MAX_TEXT_FILE_SIZE) { stats.bigSize++; continue; }
          if (!isTextLike(f))              { stats.binary++;  continue; }
          const text = await f.text();
          if (text.length > MAX_CHAR_LEN)  { stats.bigChar++; continue; }

          const ck = checksum32(text);
          // For scanned files, fullPath is relative to the scanned root.
          // insideProject will be true by definition of scanning a project root.
          out.push({ fullPath: entryPath, text, checksum: ck, insideProject: true, name: f.name });
        } else if (h.kind === 'directory') {
          await scanDir(h, out, stats, root, entryPath);
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
      await scanDir(dirHandle, batch, stats, dirHandle); // Pass dirHandle as root
      await saveRoot(dirHandle);
      setProjectRoot(dirHandle);

      const freshMap = {};
      tops.forEach(e => { freshMap[e.name] = true; }); // Default to include all top-level entries
      setEntryFilter(freshMap);

      // Filter batch based on initial freshMap before merging
      const initiallyFilteredBatch = batch.filter(f => isIncluded(f.fullPath, freshMap));
      const merged   = mergeFiles(files, initiallyFilteredBatch);
      onFilesChange(merged); // Apply merged files, will be re-filtered by useEffect if filter changes

      const skipped = stats.bigSize + stats.bigChar + stats.binary +
                      stats.limit   + stats.perm    + stats.fsErr;
      if (skipped) {
        const parts = [];
        if (stats.bigSize) parts.push(`${stats.bigSize} >${MAX_TEXT_FILE_SIZE / 1024} KB`);
        if (stats.bigChar) parts.push(`${stats.bigChar} >${MAX_CHAR_LEN / 1000}k chars`);
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
            // 'image/bmp': ['.bmp'], // BMP often large, consider removing or warning
            // 'image/tiff': ['.tif', '.tiff'], // TIFF often large
            // 'image/heic': ['.heic', '.heif'], // HEIC might need specific handling/conversion
          }
        }]
      });

      for (const h of handles) {
        const file = await h.getFile();
        const blob = await compressImageToWebP(file, 1024, 0.85); // Compress to WebP

        const path = `public/images/${crypto.randomUUID()}.webp`; // Ensure 'public' bucket if that's your policy
        const { error: upErr } = await supabase
          .storage.from('images') // Ensure this is your image bucket name
          .upload(path, blob, { contentType: 'image/webp', upsert: false });
        if (upErr) throw upErr;

        const { data: pub, error: pubErr } =
          supabase.storage.from('images').getPublicUrl(path);
        if (pubErr) throw pubErr;

        onAddImage?.({ name: file.name, url: pub.publicUrl, revoke: null }); // revoke is for local ObjectURLs
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
        const path = `public/images/${crypto.randomUUID()}.webp`;

        const { error: upErr } = await supabase
          .storage.from('images')
          .upload(path, blob, { contentType: 'image/webp', upsert: false });
        if (upErr) throw upErr;

        const { data: pub, error: pubErr } =
          supabase.storage.from('images').getPublicUrl(path);
        if (pubErr) throw pubErr;

        onAddImage?.({ name, url: pub.publicUrl, revoke: null });
        Toast('Image pasted & added', 1500);
        break; // Process first image found
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
      Toast('Gemini API Key not set. Please set it in the application settings.', 4000);
      return;
    }
    if (!window.showOpenFilePicker) {
      Toast('File picker is not supported in this browser.', 4000);
      return;
    }

    try {
      setAdding(true);
      const genAI = new GoogleGenAI(settings.apiKey);

      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });

      for (const h of handles) {
        const file = await h.getFile();

        const uploadedFile = await genAI.files.uploadFile(file, {
          mimeType: file.type || 'application/pdf',
          displayName: file.name,
        });
        
        if (uploadedFile && uploadedFile.name) {
          onAddPDF?.({
            name: file.name,
            fileId: uploadedFile.name, // Gemini file resource name (e.g., "files/...")
            mimeType: uploadedFile.mimeType || 'application/pdf'
          });
        } else {
          throw new Error('Gemini file upload did not return expected data.');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        Toast('PDF upload error: ' + err.message, 4000);
        console.error("PDF Upload Error (Gemini):", err);
      }
    } finally {
      setAdding(false);
    }
  }, [onAddPDF, settings]);

  useEffect(() => {
    // This effect re-filters the `files` list whenever `entryFilter` changes.
    // It's important if the user changes the filter *after* a folder has been scanned and files added.
    if (step !== 'FILES' || !topEntries.length) return; // Only run if in FILES step and a folder was scanned

    const newList = files.filter(f => isIncluded(f.fullPath, entryFilter));
    
    // Check if the list actually changed to avoid unnecessary re-renders or toasts
    if (newList.length !== files.length || !files.every((f, i) => newList[i] && newList[i].fullPath === f.fullPath && newList[i].checksum === f.checksum)) {
        const excludedCount = files.length - newList.length;
        onFilesChange(newList);
        if (excludedCount > 0) {
            Toast(`Excluded ${excludedCount} item${excludedCount > 1 ? 's' : ''} by filter`, 4000);
        }
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
                  checked={entryFilter[name] !== false} // Default to checked if not explicitly false
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