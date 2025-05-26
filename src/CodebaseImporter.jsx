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
import { FILE_LIMIT }             from './config.js'; // This is now the 3000 internal limit
import { checksum32 }             from './lib/checksum.js';
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
    if (out.length >= FILE_LIMIT) break; // Respect internal FILE_LIMIT (now 3000)

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

function formatRejectionMessage(rejectionStats) {
  const {
    tooLarge = 0,
    tooLong = 0, 
    unsupportedType = 0,
    limitReached = 0, 
    permissionDenied = 0,
    readError = 0,
  } = rejectionStats;

  const lines = [];
  let hasSkipsOrErrors = false;

  if (tooLarge > 0) {
    lines.push(`- ${tooLarge} file${tooLarge > 1 ? 's were' : ' was'} skipped because they were over the ${MAX_TEXT_FILE_SIZE / 1024}KB size limit.`);
    hasSkipsOrErrors = true;
  }
  if (tooLong > 0) { 
    lines.push(`- ${tooLong} file${tooLong > 1 ? 's' : ''} had too much text (over ${MAX_CHAR_LEN / 1000}k characters) and were skipped.`);
    hasSkipsOrErrors = true;
  }
  if (unsupportedType > 0) {
    lines.push(`- ${unsupportedType} file${unsupportedType > 1 ? 's were' : ' was'} skipped because they didn't appear to be text or code files (e.g., images, videos, applications).`);
    hasSkipsOrErrors = true;
  }
  if (limitReached > 0) { 
    lines.push(`- ${limitReached} file${limitReached > 1 ? 's were' : ' was'} skipped because an internal processing limit of ${FILE_LIMIT} text files was reached.`);
    hasSkipsOrErrors = true;
  }
  
  if (permissionDenied > 0) {
    hasSkipsOrErrors = true;
    const itemStr = permissionDenied > 1 ? 'items (files/folders)' : 'item (file/folder)';
    const message = 
      `- ${permissionDenied} ${itemStr} SKIPPED DUE TO ERROR:\n` + 
      `  Your computer's OS (Windows, macOS, Linux) denied read access.\n` +
      `  This means your browser lacks 'Read' permission for it.\n` +
      `  To fix: Adjust permissions on your computer.\n` + 
      `  (e.g., Win: Properties > Security; Mac: Get Info > Permissions).`;
    lines.push(message);
  }

  if (readError > 0) {
    hasSkipsOrErrors = true;
    lines.push(`- ${readError} file${readError > 1 ? 's' : ''} SKIPPED DUE TO ERROR: Could not be read (general system error).`);
  }
  
  if (!hasSkipsOrErrors) {
    return null; 
  }

  const header = "This isn't an error; skipping some files is normal during import.";
  return header + '\n\n' + lines.join('\n\n'); 
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
      const rejectionStats = { 
          count: 0, tooLarge: 0, tooLong: 0, unsupportedType: 0, 
          limitReached: 0, permissionDenied: 0, readError: 0 
      };

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) {
          rejectionStats.limitReached++;
          rejectionStats.count++; // Count files skipped due to limit
          continue; 
        }
        
        let currentFileRejected = false;
        let fileData = null;
        try {
            fileData = await h.getFile();
        } catch (fileAccessError) {
            console.warn(`Could not access file ${h.name}:`, fileAccessError);
            if (fileAccessError.name === 'NotAllowedError' || fileAccessError.name === 'SecurityError') {
                rejectionStats.permissionDenied++;
            } else {
                rejectionStats.readError++;
            }
            currentFileRejected = true;
        }

        if (currentFileRejected || !fileData) {
            if (!currentFileRejected) rejectionStats.count++; // Only count if not already counted by specific error
            continue;
        }
        
        const f = fileData;

        if (f.size > MAX_TEXT_FILE_SIZE) {
          rejectionStats.tooLarge++;
          currentFileRejected = true;
        }
        
        if (!isTextLike(f)) { 
          if (!currentFileRejected) rejectionStats.unsupportedType++;
          currentFileRejected = true; 
        }
        
        if (!currentFileRejected) { 
            const text = await f.text();
            if (text.length > MAX_CHAR_LEN) {
              rejectionStats.tooLong++;
              currentFileRejected = true;
            }
        }

        if (currentFileRejected) {
          rejectionStats.count++; 
          continue;
        }

        const textContent = await f.text(); 
        const ck = checksum32(textContent);
        const { fullPath, insideProject } = await getFullPath(h, projectRoot); 
        batch.push({ fullPath, text: textContent, checksum: ck, insideProject, name: f.name });
      }
      
      // Update rejectionStats.count to be the sum of all specific rejections if it wasn't incremented for each.
      // This ensures the toast message accurately reflects the number of files that hit any rejection criteria.
      // However, the new formatRejectionMessage doesn't use a total count in its header.
      // The presence of any specific rejection count is enough.
      // Let's ensure `count` is at least the sum of specific issues if it was missed.
      let totalSpecificRejections = rejectionStats.tooLarge + rejectionStats.tooLong + rejectionStats.unsupportedType + rejectionStats.limitReached + rejectionStats.permissionDenied + rejectionStats.readError;
      if (rejectionStats.count < totalSpecificRejections) {
          rejectionStats.count = totalSpecificRejections;
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

  async function scanDirForCandidates(handle, candidateCollector, rejectionStats, rootHandle, currentPath = '') {
    const DISCOVERY_CAP = FILE_LIMIT * 2; 

    for await (const [name, h] of handle.entries()) {
      if (candidateCollector.length >= DISCOVERY_CAP && DISCOVERY_CAP > 0) {
          break; 
      }

      const entryPath = currentPath ? `${currentPath}/${name}` : name;
      let rejectedThisFileForCause = false;
      let fileProcessedForCounting = false; // Flag to ensure count is incremented once per problematic file

      try {
        if (h.kind === 'file') {
          const f = await h.getFile();
          if (f.size > MAX_TEXT_FILE_SIZE) { rejectionStats.tooLarge++; rejectedThisFileForCause = true; }
          
          if (!isTextLike(f)) { 
            if(!rejectedThisFileForCause) rejectionStats.unsupportedType++; 
            rejectedThisFileForCause = true; 
          }
          
          if (!rejectedThisFileForCause) {
            const text = await f.text();
            if (text.length > MAX_CHAR_LEN) { rejectionStats.tooLong++; rejectedThisFileForCause = true; }
            
            if (!rejectedThisFileForCause) { 
                const ck = checksum32(text);
                candidateCollector.push({ fullPath: entryPath, text, checksum: ck, insideProject: true, name: f.name });
            }
          }
          if (rejectedThisFileForCause && !fileProcessedForCounting) {
            rejectionStats.count++; 
            fileProcessedForCounting = true;
          }

        } else if (h.kind === 'directory') {
          await scanDirForCandidates(h, candidateCollector, rejectionStats, rootHandle, entryPath);
        }
      } catch (err) {
        if (!fileProcessedForCounting) { // Ensure count is incremented if an error occurs
            rejectionStats.count++;
            fileProcessedForCounting = true;
        }
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          rejectionStats.permissionDenied++;
        } else {
          rejectionStats.readError++;
          console.warn(`FS error scanning ${entryPath}:`, err);
        }
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

      const allScannedCandidates = []; 
      const folderRejectionStats = { 
        count: 0, tooLarge: 0, tooLong: 0, unsupportedType: 0, 
        permissionDenied: 0, readError: 0, limitReached: 0 
      };
      await scanDirForCandidates(dirHandle, allScannedCandidates, folderRejectionStats, dirHandle);
      
      const freshMap = {}; 
      tops.forEach(e => { freshMap[e.name] = true; });
      setEntryFilter(freshMap);

      const existingNonProjectFiles = files.filter(f => !f.insideProject);
      let filesPassingUserFilter = allScannedCandidates.filter(f => isIncluded(f.fullPath, freshMap));
      
      let filesToProcess = filesPassingUserFilter;
      const totalFilesAvailableAfterUserFilter = existingNonProjectFiles.length + filesPassingUserFilter.length;

      if (totalFilesAvailableAfterUserFilter > FILE_LIMIT) {
          const numToTakeFromScan = FILE_LIMIT - existingNonProjectFiles.length;
          if (numToTakeFromScan >= 0) { // Check if numToTakeFromScan is non-negative
              filesToProcess = filesPassingUserFilter.slice(0, numToTakeFromScan);
              folderRejectionStats.limitReached = filesPassingUserFilter.length - numToTakeFromScan;
          } else { 
              filesToProcess = []; 
              folderRejectionStats.limitReached = filesPassingUserFilter.length;
          }
          // folderRejectionStats.count is already incremented by scanDirForCandidates for specific reasons.
          // We add limitReached to the specific counts for the toast.
          // The overall 'count' in folderRejectionStats should reflect files that hit *any* criteria.
          // Let's ensure count is at least the sum of specific issues.
          let totalSpecificRejections = folderRejectionStats.tooLarge + folderRejectionStats.tooLong + folderRejectionStats.unsupportedType + folderRejectionStats.limitReached + folderRejectionStats.permissionDenied + folderRejectionStats.readError;
          if(folderRejectionStats.count < totalSpecificRejections) folderRejectionStats.count = totalSpecificRejections;

      }
      
      const merged = mergeFiles(existingNonProjectFiles, filesToProcess);
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
    
    let filesAfterNewFilter = files.filter(f => !f.insideProject); 
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
          {/* REMOVED: <strong>{files.length} / {FILE_LIMIT} text files selected</strong> */}
          {!!files.length && (
            <p style={{ marginBottom: '8px', fontSize: '0.9em' }}>
              {files.length} text file{files.length !== 1 ? 's' : ''} ready for prompt.
            </p>
          )}
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
