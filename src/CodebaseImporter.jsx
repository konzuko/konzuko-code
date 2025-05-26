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
// Toast is now passed as a prop: toastFn
import { compressImageToWebP }    from './lib/imageUtils.js';
import { supabase }               from './lib/supabase.js';

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
  const taken = new Map();
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

// UPDATED HELPER to format rejection messages
function formatRejectionMessage(rejectionStats) {
  const {
    count = 0, 
    tooLarge = 0,
    tooLong = 0,
    unsupportedType = 0, // This now means "not a text/code file we import"
    limitReached = 0,
    permissionDenied = 0,
    readError = 0,
  } = rejectionStats;

  if (count === 0) return null; 

  const lines = [];
  let isErrorPresent = false; // Flag to track if any "real" errors occurred

  // Start with the informational header
  lines.push("This isn't an error; skipping irrelevant files is expected.");

  if (tooLarge > 0) {
    lines.push(`- ${tooLarge} file${tooLarge > 1 ? 's were' : ' was'} skipped because they were over the ${MAX_TEXT_FILE_SIZE / 1024}KB size limit.`);
  }
  if (tooLong > 0) {
    lines.push(`- ${tooLong} file${tooLong > 1 ? 's' : ''} had too much text (over ${MAX_CHAR_LEN / 1000}k characters) and were skipped.`);
  }
  if (unsupportedType > 0) {
    // Phrasing changed to be more informational
    lines.push(`- ${unsupportedType} file${unsupportedType > 1 ? 's were' : ' was'} skipped because they are images or video, so not relevant.`);
  }
  
  if (permissionDenied > 0) {
    isErrorPresent = true; // This is a user-actionable error
    const itemStr = permissionDenied > 1 ? 'items (files or folders)' : 'item (a file or folder)';
    const message = 
      `- ${permissionDenied} ${itemStr}: Your computer's operating system (like Windows, macOS, or Linux) prevented this application from reading it.\n` +
      `  This usually means the user account your web browser is running as does not have 'Read' permission for that specific file or folder on your computer.\n` +
      `  To fix this: You'll need to adjust the permissions for that ${itemStr} directly on your computer. \n` +
      `  For example:\n` +
      `    - On Windows: Right-click the file/folder > Properties > Security tab.\n` +
      `    - On macOS: Select the file/folder > File menu > Get Info > Sharing & Permissions section.`;
    lines.push(message);
  }

  if (readError > 0) {
    isErrorPresent = true; // This is also an error
    lines.push(`- ${readError} file${readError > 1 ? 's' : ''} could not be read due to a general system error on your computer (not a permission issue).`);
  }
  if (limitReached > 0) {
    lines.push(`- ${limitReached} file${limitReached > 1 ? 's were' : ' was'} skipped because the maximum import limit of ${FILE_LIMIT} files was reached.`);
  }
  
  // If the only line is the header and count > 0, it means specific reasons weren't categorized
  // or all rejections were of a type not explicitly listed above (which shouldn't happen with current logic).
  if (lines.length === 1 && count > 0) {
    // Fallback if no specific reasons were added but files were skipped.
    lines.push(`- ${count} other file${count > 1 ? 's were' : ' was'} skipped for various reasons.`);
  } else if (lines.length === 1 && count === 0) { // Only header, no rejections
    return null; 
  }

  // If there were no "real" errors (permissionDenied or readError), and other skips occurred,
  // the initial informational header is sufficient.
  // If there *were* errors, the header still applies, but the error details are also present.
  
  return lines.join('\n\n'); // Join with double newline for better separation
}


export default function CodebaseImporter({
  files = [],
  onFilesChange,
  toastFn, 
  onAddImage,
  onAddPDF,
  settings,
  onProjectRootChange, 
  currentProjectRootNameFromBuilder 
}) {
  const [adding, setAdding] = useState(false);
  const [projectRoot, setProjectRoot] = useState(null); 
  const [entryFilter, setEntryFilter] = useState({});
  const [step, setStep] = useState('FILTER'); 
  const [topEntries, setTopEntries] = useState([]);

  useEffect(() => {
    let live = true;
    loadRoot().then(h => {
        if (live) {
            setProjectRoot(h); 
            if (h) { 
                onProjectRootChange?.(h.name); 
            } else {
                onProjectRootChange?.(null); 
            }
        }
    }).catch(() => {
        if (live) onProjectRootChange?.(null); 
    });
    return () => { live = false; };
  }, [onProjectRootChange]);


  useEffect(() => {
    if (currentProjectRootNameFromBuilder === null && projectRoot !== null) {
      clearRoot()
        .catch(err => console.warn("CodebaseImporter: Failed to clear root from IDB during reset via prop", err))
        .finally(() => {
            setProjectRoot(null); 
            setTopEntries([]);    
            setEntryFilter({});
            setStep('FILTER');    
        });
    }
  }, [currentProjectRootNameFromBuilder, projectRoot]);


  const clearAll = useCallback(() => {
    if (!files.length && !projectRoot && topEntries.length === 0 && Object.keys(entryFilter).length === 0) return;
    if (!confirm('Remove all selected files and clear project root?')) return;
    
    clearRoot().then(() => {
      setProjectRoot(null); 
      onProjectRootChange?.(null); 
    }).catch(err => console.error("Error clearing root from IDB:", err));
    
    setEntryFilter({});
    setTopEntries([]);
    setStep('FILTER'); 
    onFilesChange([]); 
  }, [files.length, projectRoot, topEntries.length, Object.keys(entryFilter).length, onFilesChange, onProjectRootChange]);


  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        toastFn?.('File picker is not supported in this browser.', 4000);
        return;
    }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple: true });
      const batch = [];
      const rejectionStats = { count: 0, tooLarge: 0, tooLong: 0, unsupportedType: 0, limitReached: 0, permissionDenied: 0, readError: 0 };

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) {
          rejectionStats.limitReached++;
          rejectionStats.count++;
          continue;
        }
        
        const f = await h.getFile();
        let rejectedThisFile = false;

        if (f.size > MAX_TEXT_FILE_SIZE) {
          rejectionStats.tooLarge++;
          rejectedThisFile = true;
        }
        
        if (!isTextLike(f)) { // This checks for non-text types (images, binaries, etc.)
          if (!rejectedThisFile) rejectionStats.unsupportedType++;
          rejectedThisFile = true; 
        }
        
        if (!rejectedThisFile) { 
            const text = await f.text();
            if (text.length > MAX_CHAR_LEN) {
              rejectionStats.tooLong++;
              rejectedThisFile = true;
            }
        }

        if (rejectedThisFile) {
          rejectionStats.count++;
          continue;
        }

        const textContent = await f.text(); 
        const ck = checksum32(textContent);
        const { fullPath, insideProject } = await getFullPath(h, projectRoot); 
        batch.push({ fullPath, text: textContent, checksum: ck, insideProject, name: f.name });
      }

      const rejectionMessage = formatRejectionMessage(rejectionStats);
      if (rejectionMessage) {
        const duration = (rejectionStats.permissionDenied > 0 || rejectionStats.readError > 0) ? 20000 : 15000;
        toastFn?.(rejectionMessage, duration);
      }
      
      const merged = mergeFiles(files, batch);
      onFilesChange(merged);
    } catch (err) {
      if (err.name !== 'AbortError') toastFn?.('File pick error: ' + err.message, 5000);
    } finally {
      setAdding(false);
    }
  }, [files, onFilesChange, projectRoot, toastFn]); 

  async function scanDirAndUpdateStats(handle, out, stats, rootHandle, currentPath = '') {
    const currentTotalFilesConsidered = files.filter(f => f.insideProject && f.fullPath.startsWith(rootHandle.name + '/')).length + out.length;

    for await (const [name, h] of handle.entries()) {
      if (currentTotalFilesConsidered >= FILE_LIMIT) { // Check against overall limit
        stats.limitReached++; 
        stats.count++;
        // Do not 'continue' here, as we want to count all files that *would* be skipped by limit
        // The actual addition to 'out' will be prevented later if limit is truly met.
        // This ensures limitReached count is accurate for the toast.
      }
      const entryPath = currentPath ? `${currentPath}/${name}` : name;
      let rejectedThisFile = false;
      try {
        if (h.kind === 'file') {
          // Only attempt to add if we are not already over the limit for *actual additions*
          if (files.filter(f => f.insideProject && f.fullPath.startsWith(rootHandle.name + '/')).length + out.length < FILE_LIMIT) {
            const f = await h.getFile();
            if (f.size > MAX_TEXT_FILE_SIZE) { stats.tooLarge++; rejectedThisFile = true; }
            
            if (!isTextLike(f)) { 
              if(!rejectedThisFile) stats.unsupportedType++; 
              rejectedThisFile = true; 
            }
            
            if (!rejectedThisFile) {
              const text = await f.text();
              if (text.length > MAX_CHAR_LEN) { stats.tooLong++; rejectedThisFile = true; }
              
              if (!rejectedThisFile) {
                  const ck = checksum32(text);
                  out.push({ fullPath: entryPath, text, checksum: ck, insideProject: true, name: f.name });
              }
            }
          } else { // If we are at/over the limit for additions, count this file towards limitReached
            if (!stats.limitReachedAlreadyIncrementedForThisFile) { // Avoid double counting if already done above
                stats.limitReached++;
            }
            rejectedThisFile = true; // Mark as rejected for counting purposes
          }
          if (rejectedThisFile) stats.count++;

        } else if (h.kind === 'directory') {
          await scanDirAndUpdateStats(h, out, stats, rootHandle, entryPath);
        }
      } catch (err) {
        stats.count++; 
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          stats.permissionDenied++;
        } else {
          stats.readError++;
          console.warn(`FS error scanning ${entryPath}:`, err);
        }
      }
      // Reset flag for next file in loop
      stats.limitReachedAlreadyIncrementedForThisFile = false; 
      if (currentTotalFilesConsidered >= FILE_LIMIT && !rejectedThisFile) {
        // If the file *would* have been accepted but we are at limit, ensure it's counted for limitReached
        // This case is mostly for directories that are entered when limit is already hit.
      }
    }
  }

  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
        toastFn?.('Directory picker is not supported in this browser.', 4000);
        return;
    }
    try {
      setAdding(true);
      setEntryFilter({}); 
      setTopEntries([]);  
      setStep('FILTER');  

      const dirHandle = await window.showDirectoryPicker();
      
      setProjectRoot(dirHandle); 
      onProjectRootChange?.(dirHandle.name); 
      await saveRoot(dirHandle); 

      const tops = [];
      for await (const [name, h] of dirHandle.entries()) {
        tops.push({ name, kind: h.kind });
      }
      setTopEntries(tops);

      const batchFromScan = []; 
      const folderRejectionStats = { 
        count: 0, tooLarge: 0, tooLong: 0, unsupportedType: 0, 
        permissionDenied: 0, readError: 0, limitReached: 0 
      };
      await scanDirAndUpdateStats(dirHandle, batchFromScan, folderRejectionStats, dirHandle);
      
      const freshMap = {}; 
      tops.forEach(e => { freshMap[e.name] = true; });
      setEntryFilter(freshMap);

      const existingNonProjectFiles = files.filter(f => !f.insideProject);
      const filesPassingFilter = batchFromScan.filter(f => isIncluded(f.fullPath, freshMap));
      
      const merged = mergeFiles(existingNonProjectFiles, filesPassingFilter);
      onFilesChange(merged);
      
      const rejectionMessage = formatRejectionMessage(folderRejectionStats);
      if (rejectionMessage) {
        const duration = (folderRejectionStats.permissionDenied > 0 || folderRejectionStats.readError > 0) ? 20000 : 15000;
        toastFn?.(rejectionMessage, duration);
      }

    } catch (err) {
      if (err.name !== 'AbortError') toastFn?.('Folder pick error: ' + err.message, 5000);
    } finally {
      setAdding(false);
    }
  }, [files, onFilesChange, onProjectRootChange, toastFn, entryFilter]);

  useEffect(() => {
    if (!projectRoot || topEntries.length === 0 || step !== 'FILES') return; 
    
    let filesAfterNewFilter = files.filter(f => !f.insideProject); // Keep non-project files
    let excludedByThisFilterChange = 0;

    const allProjectFilesBeforeThisFilter = files.filter(f => f.insideProject); 
    const projectFilesKeptByNewFilter = allProjectFilesBeforeThisFilter.filter(f => isIncluded(f.fullPath, entryFilter));
    
    excludedByThisFilterChange = allProjectFilesBeforeThisFilter.length - projectFilesKeptByNewFilter.length;
    filesAfterNewFilter = filesAfterNewFilter.concat(projectFilesKeptByNewFilter);

    if (filesAfterNewFilter.length !== files.length || !files.every((f, i) => filesAfterNewFilter[i] && filesAfterNewFilter[i].checksum === f.checksum)) {
        onFilesChange(filesAfterNewFilter);
        if (excludedByThisFilterChange > 0) {
            toastFn?.(`Filtered out ${excludedByThisFilterChange} item${excludedByThisFilterChange > 1 ? 's' : ''} based on your selection.`, 4000);
        }
    }
  }, [entryFilter, step, projectRoot, topEntries, files, onFilesChange, toastFn]);


  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        toastFn?.('File picker is not supported in this browser.', 4000);
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
            toastFn?.('Image picker error: ' + pickerErr.message, 4000);
        }
        return; 
    }

    setAdding(true);
    const failedUploads = [];
    let successfulUploads = 0;

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
        successfulUploads++;
      } catch (fileProcessingErr) {
        console.error(`Error processing image ${currentFileName}:`, fileProcessingErr);
        failedUploads.push({ name: currentFileName, reason: fileProcessingErr.message });
      }
    }

    if (failedUploads.length > 0) {
        const errorLimit = 2; 
        let summary = `${failedUploads.length} image${failedUploads.length > 1 ? 's' : ''} failed to upload: `;
        summary += failedUploads.slice(0, errorLimit).map(f => f.name).join(', ');
        if (failedUploads.length > errorLimit) {
            summary += ` and ${failedUploads.length - errorLimit} more.`;
        }
        summary += " Check console for details."
        toastFn?.(summary, 8000);
    } else if (successfulUploads > 0) {
        toastFn?.(`${successfulUploads} image${successfulUploads > 1 ? 's' : ''} added.`, 3000);
    }
    setAdding(false);
  }, [onAddImage, toastFn]);

  const handlePasteImage = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      toastFn?.('Paste requires a secure context (HTTPS) and compatible browser.', 4000);
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
        toastFn?.('Image pasted & added.', 2000);
        imagePasted = true;
        break; 
      }
      if (!imagePasted) {
          toastFn?.('No image found in clipboard.', 3000);
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        toastFn?.('Browser denied clipboard access. Please check permissions.', 5000);
      } else {
        console.error("Paste image error:", err);
        toastFn?.('Paste image failed: ' + err.message, 5000);
      }
    } finally {
      setAdding(false);
    }
  }, [onAddImage, toastFn]);

  const handleAddPDF = useCallback(async () => {
    if (!settings || !settings.apiKey || String(settings.apiKey).trim() === "") {
      toastFn?.('Gemini API Key not set. Please set it in application settings.', 5000);
      return;
    }
    if (!window.showOpenFilePicker) {
      toastFn?.('File picker is not supported in this browser.', 4000);
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
            toastFn?.('PDF picker error: ' + pickerErr.message, 4000);
        }
        return; 
    }
    
    setAdding(true);
    const failedUploads = [];
    let successfulUploads = 0;
    let genAI;
    try {
        genAI = new GoogleGenAI({ apiKey: settings.apiKey });
    } catch(sdkErr) {
        toastFn?.('Failed to initialize Gemini SDK: ' + sdkErr.message, 5000);
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
          successfulUploads++;
        } else {
          throw new Error(`Gemini file upload for ${file.name} did not return expected data.`);
        }
      } catch (fileProcessingErr) {
        console.error(`[CodebaseImporter - handleAddPDF] Error processing PDF ${currentFileName}:`, fileProcessingErr, fileProcessingErr.stack);
        failedUploads.push({ name: currentFileName, reason: fileProcessingErr.message });
      }
    }

    if (failedUploads.length > 0) {
        const errorLimit = 2;
        let summary = `${failedUploads.length} PDF${failedUploads.length > 1 ? 's' : ''} failed to upload: `;
        summary += failedUploads.slice(0, errorLimit).map(f => f.name).join(', ');
        if (failedUploads.length > errorLimit) {
            summary += ` and ${failedUploads.length - errorLimit} more.`;
        }
        summary += " Check console for details."
        toastFn?.(summary, 8000);
    } else if (successfulUploads > 0) {
        toastFn?.(`${successfulUploads} PDF${successfulUploads > 1 ? 's' : ''} added.`, 3000);
    }
    setAdding(false);
  }, [onAddPDF, settings, toastFn]);


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
                  onChange={e => {
                    const newFilter = { ...entryFilter, [name]: e.target.checked };
                    setEntryFilter(newFilter);
                  }}
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
      {(step === 'FILES' || (step === 'FILTER' && (!projectRoot || topEntries.length === 0))) && ( 
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
           {files.length === 0 && step === 'FILES' && projectRoot && topEntries.length > 0 && ( 
            <p style={{ color: 'var(--text-secondary)' }}>No text files matched the filter or found in the folder.</p>
          )}
        </>
      )}
    </div>
  );
}
