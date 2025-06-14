// file: src/CodebaseImporter.jsx
import {
  useState, useCallback, useEffect, useReducer, useRef
} from 'preact/hooks';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './lib/supabase.js';
import { isTextLike, MAX_TEXT_FILE_SIZE, MAX_CHAR_LEN } from './lib/fileTypeGuards.js';
import { FILE_LIMIT } from './config.js';
import { compressImageToWebP } from './lib/imageUtils.js';
import { reducer, initialState, makeStagedFile } from './codeImporter/state.js';
import { loadRoot, saveRoot, clearRoot as clearIDBRoot } from './lib/fsRoot.js';
import {
  formatRejectionMessage,
  scanDirectoryForMinimalMetadata,
  processAndStageSelectedFiles
} from './lib/fileSystem.js'; // <-- IMPORT MOVED

export default function CodebaseImporter({
  onFilesChange, toastFn, onAddImage, onAddPDF, settings,
  onProjectRootChange, currentProjectRootNameFromBuilder,
}) {
  const [adding, setAdding] = useState(false);
  const [impState, dispatch] = useReducer(reducer, initialState);
  const lastCheckedIndexRef = useRef(null);
  const initialLoadAttemptedRef = useRef(false);
  const lastNotifiedFilesIdHashRef = useRef('');
  const scanInProgressRef = useRef(false);
  const stateRef = useRef(impState);

  useEffect(() => {
    stateRef.current = impState;
  }, [impState]);

  const performScan = useCallback(async (handleToScan, context) => {
    if (!handleToScan) {
        console.warn(`[performScan] Called without a valid handle. Context: ${context}`);
        dispatch({ type: 'CLEAR_ALL' }); return;
    }
    if (scanInProgressRef.current) {
        console.log(`[performScan] Scan already in progress for ${handleToScan.name}. Skipping for context: ${context}.`); return;
    }
    scanInProgressRef.current = true;
    console.log(`[performScan] Starting scan for ${handleToScan.name} due to ${context}`);
    try {
        const { tops, meta, rejectionStats } = await scanDirectoryForMinimalMetadata(handleToScan);
        
        if (stateRef.current.root?.name === handleToScan.name) {
            dispatch({ type: 'SCAN_DONE', tops, meta });
            const msg = formatRejectionMessage(rejectionStats, `folder scan on ${context}`);
            if (msg) toastFn?.(msg, 15000);
        } else {
            console.log(`[performScan] Scan for ${handleToScan.name} completed, but state/root changed. Discarding. Current Root: ${stateRef.current.root?.name}`);
        }
    } catch (err) {
        console.error(`[performScan] Error during scan for ${handleToScan.name} (context: ${context}):`, err);
        if (stateRef.current.root?.name === handleToScan.name) {
            dispatch({ type: 'CLEAR_ALL' }); onProjectRootChange?.(null); clearIDBRoot().catch(console.warn);
        }
        toastFn?.(`Error scanning directory (${context}): ` + err.message, 5000);
    } finally {
        scanInProgressRef.current = false;
    }
  }, [toastFn, onProjectRootChange]);

  useEffect(() => {
    if (currentProjectRootNameFromBuilder === null) {
      if (impState.root || impState.tag !== 'IDLE') {
        dispatch({ type: 'CLEAR_ALL' });
        clearIDBRoot().catch(console.warn);
      }
      return;
    }
  
    if (currentProjectRootNameFromBuilder) {
      if (impState.root?.name === currentProjectRootNameFromBuilder) {
        return;
      }
  
      loadRoot().then(handleFromIDB => {
        if (handleFromIDB?.name === currentProjectRootNameFromBuilder) {
          dispatch({ type: 'PICK_ROOT', handle: handleFromIDB });
          performScan(handleFromIDB, "SyncEffect - root change");
        } else {
          onProjectRootChange?.(null);
        }
      }).catch(err => {
        console.error('[SyncEffect] Error loading root from IDB:', err);
        onProjectRootChange?.(null);
      });
      return;
    }
  
    if (!currentProjectRootNameFromBuilder && !initialLoadAttemptedRef.current) {
      initialLoadAttemptedRef.current = true;
      loadRoot().then(handleFromIDB => {
        if (handleFromIDB) {
          onProjectRootChange?.(handleFromIDB.name);
        }
      }).catch(err => console.warn('[SyncEffect] Initial loadRoot error:', err));
    }
  }, [currentProjectRootNameFromBuilder, onProjectRootChange, performScan, impState.root, impState.tag]);

  useEffect(() => {
    if (impState.tag === 'FILTER') {
        lastCheckedIndexRef.current = null;
    }
  }, [impState.tag]);

  const pickFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { toastFn?.('Directory picker not supported.', 4000); return; }
    setAdding(true);
    try {
      const dirHandle = await window.showDirectoryPicker();
      await saveRoot(dirHandle);
      onProjectRootChange?.(dirHandle.name);
    } catch (e) {
      if (e.name !== 'AbortError') toastFn?.('Folder pick error: ' + e.message, 4000);
    } finally {
      setAdding(false);
    }
  }, [toastFn, onProjectRootChange]);

  const handleCheckboxChange = useCallback((event, path) => {
    dispatch({ type: 'TOGGLE_SELECT', path: path, desiredState: event.target.checked });
  }, []);

  const beginStagingAndReadTexts = useCallback(async () => {
    dispatch({ type: 'BEGIN_STAGING' });
    setAdding(true);
    try {
      const {stagedFiles, rejectionStats} = await processAndStageSelectedFiles(impState);
      dispatch({ type: 'STAGING_DONE', files: stagedFiles });
      const msg = formatRejectionMessage(rejectionStats, "file staging");
      if (msg) toastFn?.(msg, 15000);
    } catch (e) {
      toastFn?.('Error reading file contents: ' + e.message, 5000);
      dispatch({ type: 'CLEAR_ALL' });
    } finally {
      setAdding(false);
    }
  }, [impState, toastFn]);

  const phase = impState.tag;
  const isLoadingOperation = adding || phase === 'SCANNING' || phase === 'STAGING';

  const clearAllStatesAndNotifyParent = useCallback(() => {
    if (!confirm('Remove all selected files and clear project root?')) return;

    if (isLoadingOperation) {
        toastFn?.('Cannot clear files while an operation is in progress.', 3000);
        return;
    }

    if(impState.root) clearIDBRoot().catch(err => console.error("Error clearing root from IDB:", err));
    dispatch({ type: 'CLEAR_ALL' });
    onProjectRootChange?.(null);
  }, [onProjectRootChange, impState.root, isLoadingOperation, toastFn]);

  const pickTextFilesAndDispatch = useCallback(async () => {
    if (!window.showOpenFilePicker) { toastFn?.('File picker not supported.', 4000); return; }
    setAdding(true);
    const rejectionStats = { tooLarge: 0, tooLong: 0, unsupportedType: 0, limitReached: 0, readError: 0 };
    let filesAddedCount = 0;
    const currentFileCount = (impState.tag === 'STAGED' && impState.files) ? impState.files.length : 0;
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      const newFilesPayload = [];
      for (const h of handles) {
        if (currentFileCount + newFilesPayload.length >= FILE_LIMIT) { rejectionStats.limitReached++; continue; }
        try {
            const file = await h.getFile();
            let currentFileRejected = false;
            if (file.size > MAX_TEXT_FILE_SIZE) { rejectionStats.tooLarge++; currentFileRejected = true; }
            if (!isTextLike(file)) { if(!currentFileRejected) rejectionStats.unsupportedType++; currentFileRejected = true; }
            if (!currentFileRejected) {
                const textContent = await file.text();
                if (textContent.length > MAX_CHAR_LEN) { rejectionStats.tooLong++; currentFileRejected = true; }
                if (!currentFileRejected) {
                    newFilesPayload.push(makeStagedFile(file.name, file.size, file.type, textContent, false, file.name, null));
                    filesAddedCount++;
                }
            }
        } catch (fileError) { console.warn(`Error processing file ${h.name}:`, fileError); rejectionStats.readError++; }
      }
      if (newFilesPayload.length > 0) dispatch({ type: 'FILES_ADDED', files: newFilesPayload });
      const msg = formatRejectionMessage(rejectionStats, "individual add");
      if (msg) toastFn?.(msg, 8000);
      else if (filesAddedCount > 0) toastFn?.(`${filesAddedCount} file(s) added.`, 3000);
    } catch (err) { if (err.name !== 'AbortError') toastFn?.('File pick error: ' + err.message, 5000); }
    finally { setAdding(false); }
  }, [toastFn, impState.tag, impState.files]);

  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) { toastFn?.('File picker not supported.', 4000); return; }
    setAdding(true);
    let handles;
    try { handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Images', accept: {'image/*': ['.png','.jpg','.jpeg','.gif','.webp']}}] }); }
    catch(e){ if(e.name !== 'AbortError') toastFn?.(e.message); setAdding(false); return; }
    let successCount = 0; let failCount = 0;
    for(const h of handles){
        try{
            const file = await h.getFile();
            const blob = await compressImageToWebP(file);
            const path = `protected/${crypto.randomUUID()}.webp`;
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
    try{
        const items = await navigator.clipboard.read();
        let pasted = false;
        for(const it of items){
            const mime = it.types.find(t=>t.startsWith('image/'));
            if(!mime) continue;
            const raw = await it.getType(mime);
            const blob = await compressImageToWebP(raw);
            const name = `clipboard_${Date.now()}.webp`;
            const path = `protected/${crypto.randomUUID()}.webp`;
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
    let successCount = 0; let failCount = 0;
    let genAI;
    try { genAI = new GoogleGenAI({ apiKey: settings.apiKey });
    } catch (sdkInitError) { console.error('[handleAddPDF] SDK Init Error:', sdkInitError); toastFn?.('Gemini SDK init failed: ' + sdkInitError.message, 5000); setAdding(false); return; }

    for (const h of handles) {
      let currentFileName = "Unnamed PDF";
      try {
        const file = await h.getFile(); currentFileName = file.name;
        const uploadedFileResponse = await genAI.files.upload({ file: file, config: { mimeType: file.type || 'application/pdf', displayName: file.name, } });
        if (uploadedFileResponse?.uri) {
          onAddPDF?.({ name: uploadedFileResponse.displayName || file.name, fileId: uploadedFileResponse.uri, mimeType: uploadedFileResponse.mimeType, resourceName: uploadedFileResponse.name, });
          successCount++;
        } else throw new Error(`Gemini PDF upload for ${file.name} missing URI.`);
      } catch (fileProcessingErr) { console.error(`[handleAddPDF] Error for ${currentFileName}:`, fileProcessingErr); toastFn?.(`PDF ${currentFileName} failed: ${fileProcessingErr.message}`, 6000); failCount++; }
    }
    if (successCount > 0 && failCount === 0) toastFn?.(`${successCount} PDF(s) uploaded.`, 3000);
    else if (successCount > 0 && failCount > 0) toastFn?.(`${successCount} PDF(s) uploaded, ${failCount} failed.`, 5000);
    else if (failCount > 0 && successCount === 0 && handles.length > 0) toastFn?.(`All ${failCount} PDF uploads failed.`, 5000);
    setAdding(false);
  }, [onAddPDF, settings, toastFn]);

  useEffect(() => { // Effect to call onFilesChange
    if (impState.tag === 'STAGED') {
      const filesToParent = impState.files.map(f => ({
          id: f.id,
          fullPath: f.path,
          text: f.text,
          insideProject: f.insideProject,
          name: f.name,
          rootName: f.rootName
      }));
      const currentHash = filesToParent.map(f => f.id).sort().join(',');
      if (currentHash !== lastNotifiedFilesIdHashRef.current) {
          console.log('[onFilesChangeEffect] STAGED. Notifying parent with', filesToParent.length, 'files. UID Hash:', currentHash);
          onFilesChange(filesToParent.slice(0, FILE_LIMIT));
          lastNotifiedFilesIdHashRef.current = currentHash;
      } else {
          console.log('[onFilesChangeEffect] STAGED. File list (by ID) unchanged, not notifying parent. UID Hash:', currentHash);
      }
    } else if (impState.tag === 'IDLE') {
      if (lastNotifiedFilesIdHashRef.current !== '') {
          console.log('[onFilesChangeEffect] IDLE. Notifying parent with [].');
          onFilesChange([]);
          lastNotifiedFilesIdHashRef.current = '';
      }
    }
  }, [impState, onFilesChange]);

  const allRoots = (phase === 'STAGED' && impState.files) ? [...new Set(impState.files.map(f => f.rootName).filter(Boolean))] : [];
  const hasContent = impState.root || (impState.files && impState.files.length > 0);

  return (
    <div className="file-pane-container">
      <h2>Codebase Importer</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '1rem' }}>
        {/* Top Row */}
        <button className="button" onClick={pickFolder} disabled={isLoadingOperation}>
          {hasContent ? '+ Add More Folders' : '+ Add Folder'}
        </button>
        <button className="button" onClick={pickTextFilesAndDispatch} disabled={isLoadingOperation}>
          {hasContent ? '+ Add More Documents' : '+ Add Document'}
        </button>
        <button className="button" onClick={clearAllStatesAndNotifyParent}
          disabled={isLoadingOperation || phase === 'IDLE'}
          style={(phase !== 'IDLE') ? { background: '#b71c1c', color: '#fff' } : {}} > Clear Files
        </button>
        
        {/* Bottom Row */}
        <button className="button" onClick={handleAddImages} disabled={adding}>+ Add Images</button>
        <button className="button" onClick={handlePasteImage} disabled={adding}>Paste Image</button>
        <button className="button" onClick={handleAddPDF} disabled={adding}>+ Add PDF</button>
      </div>

      {(phase === 'SCANNING' || phase === 'STAGING') && (
         <div className="analysing-animation-container">
            <span className="analysing-text">{phase === 'SCANNING' ? 'Scanning folder (metadata)...' : 'Processing selected files...'}</span>
            <div className="analysing-dots"><span></span><span></span><span></span></div>
        </div>
      )}
      {phase === 'FILTER' && (
        <>
          <h3>Select entries to include from '{impState.root?.name}'</h3>
          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px 0', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px' }}>
            {impState.tops.map((t) => (
              <label key={t.name} style={{ display: 'block', margin: '4px 8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={impState.selected.has(t.name)}
                  onChange={e => handleCheckboxChange(e, t.name)}
                  style={{ marginRight: '8px' }} disabled={isLoadingOperation} />
                {t.kind === 'directory' ? '📁' : '📄'} <strong>{t.name}</strong>
              </label>
            ))}
          </div>
          <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
            <button className="button button-accent button-glow"
              disabled={isLoadingOperation || impState.selected.size === 0}
              onClick={beginStagingAndReadTexts} > Pick these Files
            </button>
            <button className="button" style={{background: '#000', color: '#fff'}}
              disabled={isLoadingOperation}
              onClick={() => dispatch({ type: 'BULK_SELECT', paths: impState.tops.map(t => t.name), select: true })}
            > Select All </button>
            <button className="button" style={{background: '#000', color: '#fff'}}
              disabled={isLoadingOperation}
              onClick={() => dispatch({ type: 'BULK_SELECT', paths: impState.tops.map(t => t.name), select: false })}
            > Deselect All </button>
          </div>
        </>
      )}
      {phase === 'STAGED' && impState.files && (
        <>
          {allRoots.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: '0.85rem', opacity: 0.8 }}>
              <strong>Sources:</strong>
              {allRoots.map(root => (
                <div key={root} style={{ marginLeft: '1em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                  <span>📁</span>
                  <code>{root}</code>
                </div>
              ))}
            </div>
          )}
          <p style={{ marginBottom: '8px', fontSize: '0.9em' }}> {impState.files.length} text file(s) staged. </p>
          {impState.files.length > 0 && (
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
                      marginLeft: '10px', 
                      cursor: 'pointer', 
                      color: 'var(--error)', 
                      background: 'none', 
                      border: 'none',
                      fontSize: '1.2rem',
                      lineHeight: '1',
                      padding: '0 4px'
                    }}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
          {impState.files.length === 0 && ( <p style={{ color: 'var(--text-secondary)' }}></p> )}
        </>
      )}
      {phase === 'IDLE' && !isLoadingOperation && ( <p style={{ color: 'var(--text-secondary)' }}></p> )}
    </div>
  );
}
