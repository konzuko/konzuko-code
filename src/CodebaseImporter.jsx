/* src/CodebaseImporter.jsx
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
import { FILE_LIMIT }             from './config.js';
import { checksum32 }             from './lib/checksum.js';
import Toast                      from './components/Toast.jsx';
import { compressImageToWebP }    from './lib/imageUtils.js';
import { supabase }               from './lib/supabase.js';

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
export default function CodebaseImporter({
  files             = [],
  onFilesChange,
  onSkip,

  onAddImage,
  onAddPDF,
  settings,
  onProjectRootChange // New prop
}) {
  const [adding, setAdding]           = useState(false);
  const [projectRoot, setProjectRoot] = useState(null);

  const [entryFilter, setEntryFilter] = useState({});
  const [step, setStep]               = useState('FILTER');
  const [topEntries, setTopEntries]   = useState([]);

  useEffect(() => {
    let live = true;
    loadRoot().then(h => {
        if (live) {
            setProjectRoot(h);
            if (h) { // If a root was loaded from IDB, notify App
                onProjectRootChange?.(h.name);
            }
        }
    }).catch(() => {});
    return () => { live = false; };
  }, [onProjectRootChange]); // Added onProjectRootChange to dependency array

  const clearAll = useCallback(() => {
    if (!files.length && !projectRoot && topEntries.length === 0 && Object.keys(entryFilter).length === 0) return;
    if (!confirm('Remove all selected files and clear project root?')) return;
    
    clearRoot().then(() => {
      setProjectRoot(null);
      onProjectRootChange?.(null); // Notify App that root is cleared
    }).catch(err => console.error("Error clearing root:", err));
    
    setEntryFilter({});
    setTopEntries([]);
    setStep('FILTER'); // Or an appropriate initial step
    onFilesChange([]); // Clear all files from the main list
  }, [files.length, projectRoot, topEntries.length, Object.keys(entryFilter).length, onFilesChange, onProjectRootChange]);


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
        // For individually added files, projectRoot is passed to getFullPath.
        // If projectRoot is null, insideProject will be false and fullPath will be f.name
        const { fullPath, insideProject } = await getFullPath(h, projectRoot);
        batch.push({ fullPath, text, checksum: ck, insideProject, name: f.name });
      }

      if (skipped) onSkip?.(skipped);
      const merged = mergeFiles(files, batch);
      onFilesChange(merged);
      // Do not change step to 'FILES' here, as 'FILTER' step is for folder operations
      // If a folder is already selected, files are just added.
      // If no folder selected, and filter UI is not relevant, this is fine.
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
      setEntryFilter({}); // Reset filter for new folder
      setTopEntries([]);  // Reset top entries for new folder
      setStep('FILTER');  // Always go to filter step for a new folder

      const dirHandle = await window.showDirectoryPicker();
      
      // Update project root state and notify App
      setProjectRoot(dirHandle); 
      onProjectRootChange?.(dirHandle.name);
      await saveRoot(dirHandle); // Save to IDB

      const tops = [];
      for await (const [name, h] of dirHandle.entries()) {
        tops.push({ name, kind: h.kind });
      }
      setTopEntries(tops);

      const batch = []; // Files from the new directory
      const stats = { bigSize:0, bigChar:0, binary:0, limit:0, perm:0, fsErr:0 };
      await scanDir(dirHandle, batch, stats, dirHandle);
      
      const freshMap = {}; // Initial filter state: include all top-level entries
      tops.forEach(e => { freshMap[e.name] = true; });
      setEntryFilter(freshMap);

      // When adding a new folder, decide how to handle existing files.
      // Option: Keep files that are not part of *any* project root (insideProject === false)
      const existingNonProjectFiles = files.filter(f => !f.insideProject);
      const initiallyFilteredBatch = batch.filter(f => isIncluded(f.fullPath, freshMap));
      const merged = mergeFiles(existingNonProjectFiles, initiallyFilteredBatch);
      onFilesChange(merged);


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
  }, [files, onFilesChange, onProjectRootChange]);


  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        Toast('File picker is not supported in this browser.', 4000);
        return;
    }
    let handles;
    try {
        handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{
                description: 'Images',
                accept: {
                    'image/png': ['.png'],
                    'image/jpeg': ['.jpg', '.jpeg'],
                    'image/webp': ['.webp'],
                    'image/gif': ['.gif'],
                }
            }]
        });
    } catch (pickerErr) {
        if (pickerErr.name !== 'AbortError') {
            Toast('Image picker error: ' + pickerErr.message, 4000);
        }
        return; // Exit if picker fails or is aborted
    }

    setAdding(true);
    const failedUploads = [];

    for (const h of handles) {
      let currentFileName = "Unnamed file";
      try {
        const file = await h.getFile();
        currentFileName = file.name; 
        const blob = await compressImageToWebP(file, 1024, 0.85);

        const path = `public/images/${crypto.randomUUID()}.webp`;
        const { error: upErr } = await supabase
          .storage.from('images')
          .upload(path, blob, { contentType: 'image/webp', upsert: false });
        if (upErr) throw upErr;

        const { data: pub, error: pubErr } =
          supabase.storage.from('images').getPublicUrl(path);
        if (pubErr) throw pubErr;

        onAddImage?.({ name: file.name, url: pub.publicUrl, revoke: null });
      } catch (fileProcessingErr) {
        console.error(`Error processing image ${currentFileName}:`, fileProcessingErr);
        failedUploads.push({ name: currentFileName, reason: fileProcessingErr.message });
      }
    }

    if (failedUploads.length > 0) {
        const errorLimit = 3;
        let summary = `${failedUploads.length} image${failedUploads.length > 1 ? 's' : ''} failed to upload: `;
        summary += failedUploads.slice(0, errorLimit).map(f => f.name).join(', ');
        if (failedUploads.length > errorLimit) {
            summary += ` and ${failedUploads.length - errorLimit} more.`;
        }
        summary += " Check console for details."
        Toast(summary, 5000);
    }
    setAdding(false);
  }, [onAddImage]);

  const handlePasteImage = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      Toast('Paste requires a secure context (HTTPS) and compatible browser.', 4000);
      return;
    }
    try {
      setAdding(true);
      const items = await navigator.clipboard.read();
      let imagePasted = false;
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
        imagePasted = true;
        break; 
      }
      if (!imagePasted) {
          Toast('No image found in clipboard.', 3000);
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
    if (!settings || !settings.apiKey || String(settings.apiKey).trim() === "") {
      Toast('Gemini API Key not set. Please set it in application settings.', 4000);
      return;
    }
    if (!window.showOpenFilePicker) {
      Toast('File picker is not supported in this browser.', 4000);
      return;
    }

    let handles;
    try {
        handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
        });
    } catch (pickerErr) {
        if (pickerErr.name !== 'AbortError') {
            Toast('PDF picker error: ' + pickerErr.message, 4000);
        }
        return; // Exit if picker fails or is aborted
    }
    
    setAdding(true);
    const failedUploads = [];
    let genAI;
    try {
        genAI = new GoogleGenAI({ apiKey: settings.apiKey });
    } catch(sdkErr) {
        Toast('Failed to initialize Gemini SDK: ' + sdkErr.message, 5000);
        setAdding(false);
        return;
    }

    for (const h of handles) {
      let currentFileName = "Unnamed PDF";
      try {
        const file = await h.getFile();
        currentFileName = file.name;

        const uploadedFile = await genAI.files.upload({
          file: file,
          config: {
            mimeType: file.type || 'application/pdf',
            displayName: file.name,
          }
        });
        
        if (uploadedFile && uploadedFile.uri && uploadedFile.name) {
          onAddPDF?.({
            name: file.name, 
            fileId: uploadedFile.uri, 
            mimeType: uploadedFile.mimeType || 'application/pdf',
            resourceName: uploadedFile.name 
          });
        } else {
          throw new Error(`Gemini file upload for ${file.name} did not return expected data.`);
        }
      } catch (fileProcessingErr) {
        console.error(`[CodebaseImporter - handleAddPDF] Error processing PDF ${currentFileName}:`, fileProcessingErr, fileProcessingErr.stack);
        failedUploads.push({ name: currentFileName, reason: fileProcessingErr.message });
      }
    }

    if (failedUploads.length > 0) {
        const errorLimit = 3;
        let summary = `${failedUploads.length} PDF${failedUploads.length > 1 ? 's' : ''} failed to upload: `;
        summary += failedUploads.slice(0, errorLimit).map(f => f.name).join(', ');
        if (failedUploads.length > errorLimit) {
            summary += ` and ${failedUploads.length - errorLimit} more.`;
        }
        summary += " Check console for details."
        Toast(summary, 5000);
    }
    setAdding(false);
  }, [onAddPDF, settings]);

  useEffect(() => {
    if (step !== 'FILES' || !topEntries.length) return; // Only apply filter changes when in FILES step AND after a folder was processed

    // This effect re-filters `files` based on `entryFilter` changes
    // It should primarily run after `setEntryFilter` is called and `step` is 'FILES'
    const newList = files.filter(f => {
        if (f.insideProject && projectRoot) { // Only filter project files
            return isIncluded(f.fullPath, entryFilter);
        }
        return true; // Keep non-project files
    });
    
    if (newList.length !== files.length || !files.every((f, i) => newList[i] && newList[i].fullPath === f.fullPath && newList[i].checksum === f.checksum)) {
        const excludedCount = files.length - newList.length;
        onFilesChange(newList);
        if (excludedCount > 0) {
            Toast(`Excluded ${excludedCount} item${excludedCount > 1 ? 's' : ''} by filter`, 4000);
        }
    }
  }, [entryFilter, files, step, onFilesChange, topEntries.length, projectRoot]);


  return (
    <div className="file-pane-container">
      <h2>Codebase Importer</h2>
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
      {step === 'FILTER' && topEntries.length > 0 && projectRoot && (
        <div>
          <h3>Select entries to include from '{projectRoot.name}'</h3>
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
            Apply Filter & View Files
          </button>
        </div>
      )}
      {(step === 'FILES' || (step === 'FILTER' && (!projectRoot || topEntries.length === 0))) && ( // Show file list if in FILES step OR if in FILTER but no folder processed yet
        <>
          <strong>{files.length} / {FILE_LIMIT} text files selected</strong>
          {!!files.length && (
            <ul className="file-pane-filelist">
              {files.map((f, i) => (
                <li key={`${f.fullPath}-${i}-${f.checksum}`} style={{ position: 'relative' }}>
                  {f.note
                    ? <span title={f.note}>{f.fullPath}</span>
                    : f.insideProject
                      ? f.fullPath // This is already relative to projectRoot if insideProject is true
                      : <span title="This file is not part of the selected project root. Its path is its name.">📄 {f.fullPath}</span>
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
          {files.length === 0 && (step === 'FILES' || (step === 'FILTER' && (!projectRoot || topEntries.length === 0))) && (
            <p style={{ color: 'var(--text-secondary)' }}>No text files added yet. Use the buttons above.</p>
          )}
           {files.length === 0 && step === 'FILES' && projectRoot && topEntries.length > 0 && ( // This case: files were filtered out
            <p style={{ color: 'var(--text-secondary)' }}>No text files matched the filter or found in the folder.</p>
          )}
        </>
      )}
    </div>
  );
}
