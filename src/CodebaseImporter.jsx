// file: src/CodebaseImporter.jsx
import { useState, useCallback, useEffect, useReducer, useRef } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './lib/supabase.js';
import { isTextLike, MAX_TEXT_FILE_SIZE, MAX_CHAR_LEN } from './lib/fileTypeGuards.js';
import { FILE_LIMIT, MAX_CUMULATIVE_FILE_SIZE } from './config.js';
import { compressImageToWebP } from './lib/imageUtils.js';
import { imagePathFor } from './lib/pathUtils.js';
import { reducer, initialState, makeStagedFile } from './codeImporter/state.js';
import { saveRoot, clearRoot as clearIDBRoot } from './lib/fsRoot.js';
import {
  formatRejectionMessage,
  scanDirectoryForMinimalMetadata,
  processAndStageSelectedFiles
} from './lib/fileSystem.js';

function DirectorySelector({ scanData, onStageFiles, onCancel, toastFn }) {
  const [selected, setSelected] = useState(new Set());
  const [isStaging, setIsStaging] = useState(false);

  const handleCheckboxChange = (path, isChecked) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (isChecked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const handleBulkSelect = (shouldSelect) => {
    if (shouldSelect) {
      setSelected(new Set(scanData.tops.map(t => t.name)));
    } else {
      setSelected(new Set());
    }
  };

  const handleStage = async () => {
    setIsStaging(true);
    try {
      const { stagedFiles, rejectionStats } = await processAndStageSelectedFiles({
        root: scanData.root,
        meta: scanData.meta,
        selected,
      });
      onStageFiles(stagedFiles, scanData.root);
      const msg = formatRejectionMessage(rejectionStats, "file staging");
      if (msg) toastFn?.(msg, 15000);
    } catch (e) {
      toastFn?.('Error reading file contents: ' + e.message, 5000);
    } finally {
      setIsStaging(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', padding: 'var(--space-md)', borderRadius: 'var(--radius)', marginTop: '1rem' }}>
      <h3>Select entries to include from '{scanData.root.name}'</h3>
      <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px 0', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px' }}>
        {scanData.tops.map((t) => (
          <label key={t.name} style={{ display: 'block', margin: '4px 8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selected.has(t.name)}
              onChange={e => handleCheckboxChange(t.name, e.target.checked)}
              style={{ marginRight: '8px' }}
              disabled={isStaging}
            />
            {t.kind === 'directory' ? '📁' : '📄'} <strong>{t.name}</strong>
          </label>
        ))}
      </div>
      <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
        <button className="button button-accent button-glow" disabled={isStaging || selected.size === 0} onClick={handleStage}>
          {isStaging ? 'Processing...' : 'Pick these Files'}
        </button>
        <button className="button" style={{background: '#000', color: '#fff'}} disabled={isStaging} onClick={() => handleBulkSelect(true)}>
          Select All
        </button>
        <button className="button" style={{background: '#000', color: '#fff'}} disabled={isStaging} onClick={() => handleBulkSelect(false)}>
          Deselect All
        </button>
        <button className="button" onClick={onCancel} disabled={isStaging}>Cancel</button>
      </div>
    </div>
  );
}


export default function CodebaseImporter({
  onFilesChange, toastFn, onAddImage, onAddPDF, settings, onClearAll
}) {
  const [adding, setAdding] = useState(false);
  const [impState, dispatch] = useReducer(reducer, initialState);
  const [directoryHandle, setDirectoryHandle] = useState(null);

  useEffect(() => {
    onFilesChange(impState.files);
  }, [impState.files, onFilesChange]);

  const {
    data: scanData,
    isLoading: isScanning,
    isError: scanError,
    error: scanErrorMessage,
  } = useQuery({
    queryKey: ['directoryScan', directoryHandle?.name],
    queryFn: async () => {
      toastFn?.(`Scanning '${directoryHandle.name}'...`, 2000);
      const { tops, meta, rejectionStats } = await scanDirectoryForMinimalMetadata(directoryHandle);
      const msg = formatRejectionMessage(rejectionStats, `folder scan`);
      if (msg) toastFn?.(msg, 15000);
      return { root: directoryHandle, tops, meta };
    },
    enabled: !!directoryHandle,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const pickFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { toastFn?.('Directory picker not supported.', 4000); return; }
    setAdding(true);
    try {
      const dirHandle = await window.showDirectoryPicker();
      await saveRoot(dirHandle);
      setDirectoryHandle(dirHandle);
    } catch (e) {
      if (e.name !== 'AbortError') toastFn?.('Folder pick error: ' + e.message, 4000);
    } finally {
      setAdding(false);
    }
  }, [toastFn]);

  const handleStageFiles = useCallback((files, root) => {
    dispatch({ type: 'ADD_FILES', files, root });
    setDirectoryHandle(null);
  }, []);

  const clearAllStates = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
    setDirectoryHandle(null);
    clearIDBRoot().catch(err => console.error("Error clearing root from IDB:", err));
  }, []);

  // FIX: Pass the clear function up to the parent (App.jsx)
  // so it can be called when a message is sent.
  useEffect(() => {
    if (onClearAll) {
      onClearAll.current = clearAllStates;
    }
  }, [onClearAll, clearAllStates]);

  const handleManualClear = () => {
    if (confirm('Remove all selected files and clear project root?')) {
        clearAllStates();
    }
  }

  const pickTextFilesAndDispatch = useCallback(async () => {
    if (!window.showOpenFilePicker) { toastFn?.('File picker not supported.', 4000); return; }
    setAdding(true);
    const rejectionStats = { tooLarge: 0, tooLong: 0, unsupportedType: 0, limitReached: 0, readError: 0, cumulativeSizeReached: 0 };
    let filesAddedCount = 0;
    let cumulativeSize = 0;
    const currentFileCount = impState.files.length;
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      const newFilesPayload = [];
      for (const h of handles) {
        if (currentFileCount + newFilesPayload.length >= FILE_LIMIT) { rejectionStats.limitReached++; continue; }
        try {
            const file = await h.getFile();
            if (cumulativeSize + file.size > MAX_CUMULATIVE_FILE_SIZE) { rejectionStats.cumulativeSizeReached++; continue; }

            let currentFileRejected = false;
            if (file.size > MAX_TEXT_FILE_SIZE) { rejectionStats.tooLarge++; currentFileRejected = true; }
            if (!isTextLike(file)) { if(!currentFileRejected) rejectionStats.unsupportedType++; currentFileRejected = true; }
            if (!currentFileRejected) {
                const textContent = await file.text();
                if (textContent.length > MAX_CHAR_LEN) { rejectionStats.tooLong++; currentFileRejected = true; }
                if (!currentFileRejected) {
                    newFilesPayload.push(makeStagedFile(file.name, file.size, file.type, textContent, false, file.name, null));
                    filesAddedCount++;
                    cumulativeSize += file.size;
                }
            }
        } catch (fileError) { console.warn(`Error processing file ${h.name}:`, fileError); rejectionStats.readError++; }
      }
      if (newFilesPayload.length > 0) dispatch({ type: 'ADD_FILES', files: newFilesPayload, root: null });
      const msg = formatRejectionMessage(rejectionStats, "individual add");
      if (msg) toastFn?.(msg, 8000);
      else if (filesAddedCount > 0) toastFn?.(`${filesAddedCount} file(s) added.`, 3000);
    } catch (err) { if (err.name !== 'AbortError') toastFn?.('File pick error: ' + err.message, 5000); }
    finally { setAdding(false); }
  }, [toastFn, impState.files.length]);

  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) { toastFn?.('File picker not supported.', 4000); return; }
    setAdding(true);
    let handles;
    try { handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Images', accept: {'image/*': ['.png','.jpg','.jpeg','.gif','.webp']}}] }); }
    catch(e){ if(e.name !== 'AbortError') toastFn?.(e.message); setAdding(false); return; }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toastFn?.('You must be signed in to upload images.', 4000);
      setAdding(false);
      return;
    }

    let successCount = 0; let failCount = 0;
    for(const h of handles){
        try{
            const file = await h.getFile();
            const blob = await compressImageToWebP(file);
            const path = imagePathFor(session.user.id);
            const {error:upErr} = await supabase.storage.from('images').upload(path,blob,{contentType:'image/webp', upsert:false});
            if(upErr) throw upErr;
            
            onAddImage?.({name:file.name, path: path});
            successCount++;
        }catch(e){console.error(`[handleAddImages] Error for ${h.name}:`, e); toastFn?.(`Image ${h.name} failed: ${e.message}`,4000); failCount++;}
    }
    if(successCount > 0 && failCount === 0) toastFn?.(`${successCount} image(s) added.`, 2000);
    else if (successCount > 0 && failCount > 0) toastFn?.(`${successCount} image(s) added, ${failCount} failed. Check console.`, 4000);
    else if (failCount > 0 && successCount === 0 && handles.length > 0) toastFn?.(`All ${failCount} image uploads failed. Check console.`, 4000);
    setAdding(false);
  }, [onAddImage, toastFn]);

  const handlePasteImage = useCallback(async () => {
    if(!navigator.clipboard?.read){ toastFn?.('Clipboard API not supported or permission denied.',4000); return; }
    setAdding(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      toastFn?.('You must be signed in to paste images.', 4000);
      setAdding(false);
      return;
    }

    try{
        const items = await navigator.clipboard.read();
        let pasted = false;
        for(const it of items){
            const mime = it.types.find(t=>t.startsWith('image/'));
            if(!mime) continue;
            const raw = await it.getType(mime);
            const blob = await compressImageToWebP(raw);
            const name = `clipboard_${Date.now()}.webp`;
            const path = imagePathFor(session.user.id);
            const {error:upErr} = await supabase.storage.from('images').upload(path,blob,{contentType:'image/webp', upsert: false});
            if(upErr) throw upErr;

            onAddImage?.({name, path: path});
            toastFn?.('Image pasted.',2000); pasted = true; break;
        }
        if(!pasted && items.length > 0) toastFn?.('No image found in clipboard.', 3000);
        else if (items.length === 0) toastFn?.('Clipboard is empty or no readable items.', 3000);
    }catch(e){
        if(e.name === 'NotAllowedError') toastFn?.('Clipboard permission denied by browser.', 5000);
        else { console.error("[handlePasteImage] Error:", e); toastFn?.('Paste failed: '+e.message,4000); }
    }
    setAdding(false);
  }, [onAddImage, toastFn]);

  const handleAddPDF = useCallback(async () => {
    if (!settings?.apiKey || String(settings.apiKey).trim() === "") { toastFn?.('Gemini API Key not set.', 5000); return; }
    if (!window.showOpenFilePicker) { toastFn?.('File picker not supported.', 4000); return; }
    setAdding(true);
    let handles;
    try { handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); }
    catch (e) { if (e.name !== 'AbortError') toastFn?.('PDF picker error: ' + e.message, 4000); setAdding(false); return; }
    
    let genAI;
    try { genAI = new GoogleGenAI({ apiKey: settings.apiKey });
    } catch (sdkInitError) { console.error('[handleAddPDF] SDK Init Error:', sdkInitError); toastFn?.('Gemini SDK init failed: ' + sdkInitError.message, 5000); setAdding(false); return; }

    let successCount = 0; let failCount = 0;
    for (const h of handles) {
      let currentFileName = "Unnamed PDF";
      try {
        const file = await h.getFile(); currentFileName = file.name;
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            toastFn?.(`Skipping "${file.name}": not a valid PDF file.`, 4000);
            failCount++;
            continue;
        }
        
        const uploadedFileResponse = await genAI.files.upload({ 
            file: file, 
            config: { mimeType: file.type || 'application/pdf', displayName: file.name } 
        });

        if (uploadedFileResponse?.name) {
          onAddPDF?.({ 
            name: uploadedFileResponse.displayName || file.name, 
            fileId: uploadedFileResponse.name,
            mimeType: uploadedFileResponse.mimeType, 
            resourceName: uploadedFileResponse.name, 
          });
          successCount++;
        } else {
            throw new Error(`Gemini PDF upload for ${file.name} did not return a file name.`);
        }

      } catch (fileProcessingErr) { 
          console.error(`[handleAddPDF] Error for ${currentFileName}:`, fileProcessingErr); 
          toastFn?.(`PDF ${currentFileName} failed: ${fileProcessingErr.message}`, 6000); 
          failCount++; 
      }
    }
    if (successCount > 0 && failCount === 0) toastFn?.(`${successCount} PDF(s) uploaded.`, 3000);
    else if (successCount > 0 && failCount > 0) toastFn?.(`${successCount} PDF(s) uploaded, ${failCount} failed.`, 5000);
    else if (failCount > 0 && successCount === 0 && handles.length > 0) toastFn?.(`All ${failCount} PDF uploads failed.`, 5000);
    setAdding(false);
  }, [onAddPDF, settings, toastFn]);

  const allRoots = [...new Set(impState.files.map(f => f.rootName).filter(Boolean))];
  const hasContent = allRoots.length > 0 || impState.files.length > 0;
  const isLoading = adding || isScanning;

  return (
    <div className="file-pane-container">
      <h2>Codebase Importer</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '1rem' }}>
        <button className="button" onClick={pickFolder} disabled={isLoading}>
          + Add Project Folder
        </button>
        <button className="button" onClick={pickTextFilesAndDispatch} disabled={isLoading}>
          + Add Document
        </button>
        <button className="button" onClick={handleManualClear}
          disabled={isLoading || !hasContent}
          style={hasContent ? { background: '#b71c1c', color: '#fff' } : {}} > Clear All
        </button>
        <button className="button" onClick={handleAddImages} disabled={adding}>+ Add Images</button>
        <button className="button" onClick={handlePasteImage} disabled={adding}>Paste Image</button>
        <button className="button" onClick={handleAddPDF} disabled={adding}>+ Add PDF</button>
      </div>

      {isScanning && (
         <div className="analysing-animation-container">
            <span className="analysing-text">Scanning folder...</span>
            <div className="analysing-dots"><span></span><span></span><span></span></div>
        </div>
      )}

      {scanError && (
        <div style={{ color: 'var(--error)', padding: '8px', border: '1px solid var(--error)', borderRadius: '4px', marginTop: '1rem' }}>
          <p><strong>Error scanning directory:</strong></p>
          <p>{scanErrorMessage.message}</p>
          <p style={{ fontSize: '0.8em', marginTop: '4px' }}>Please ensure you have granted file system permissions.</p>
        </div>
      )}

      {scanData && <DirectorySelector scanData={scanData} onStageFiles={handleStageFiles} onCancel={() => setDirectoryHandle(null)} toastFn={toastFn} />}

      {impState.files.length > 0 && (
        <>
          {allRoots.length > 0 && (
            <div style={{ marginTop: 16, marginBottom: 8, fontSize: '0.85rem', opacity: 0.8 }}>
              <strong>Project Sources:</strong>
              {allRoots.map(root => (
                <div key={root} style={{ marginLeft: '1em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                  <span>📁</span>
                  <code>{root}</code>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginBottom: '8px', fontSize: '0.9em' }}> {impState.files.length} file(s) staged for context. </p>
          <ul className="file-pane-filelist">
            {impState.files.map((f) => (
              <li key={f.id} title={`${f.path} (${f.charCount.toLocaleString()} chars)`} style={{ display: 'flex', alignItems: 'center' }}> 
                <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '1rem' }}>
                  {f.path.length > 50 ? `...${f.path.slice(-47)}` : f.path}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8em', flexShrink: 0 }}>
                  {f.charCount.toLocaleString()}
                </span>
                <button
                  onClick={() => dispatch({type: 'REMOVE_STAGED_FILE', id: f.id})}
                  title={`Remove ${f.name}`}
                  style={{ 
                    marginLeft: '10px', cursor: 'pointer', color: 'var(--error)', 
                    background: 'none', border: 'none', fontSize: '1.2rem',
                    lineHeight: '1', padding: '0 4px'
                  }}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
