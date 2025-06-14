/* src/CodebaseImporter.jsx */
/*  src/CodebaseImporter.jsx  – Fix for "+ Add Files" working independently */
import {
  useState, useCallback, useEffect, useReducer, useRef
} from 'preact/hooks';
import { GoogleGenAI }          from '@google/genai';
import { supabase }             from './lib/supabase.js';
import {
  isTextLike, MAX_TEXT_FILE_SIZE, MAX_CHAR_LEN
} from './lib/fileTypeGuards.js';
import { FILE_LIMIT }           from './config.js';
import { compressImageToWebP }  from './lib/imageUtils.js';
import {
  reducer, initialState,
  makeTopEntry,
  makeStagedFile
} from './codeImporter/state.js';
import { loadRoot, saveRoot, clearRoot as clearIDBRoot } from './lib/fsRoot.js';


function formatRejectionMessage(rejectionStats, context = "folder scan") {
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
  if (tooLarge > 0) { lines.push(`- ${tooLarge} file(s) skipped (over ${MAX_TEXT_FILE_SIZE / 1024}KB).`); hasSkipsOrErrors = true; }
  if (tooLong > 0) { lines.push(`- ${tooLong} file(s) skipped (over ${MAX_CHAR_LEN / 1000}k chars).`); hasSkipsOrErrors = true; }
  if (unsupportedType > 0) { lines.push(`- ${unsupportedType} file(s) skipped (not text/code).`); hasSkipsOrErrors = true; }
  if (limitReached > 0) { const item = context === "folder scan" ? "entries during scan" : "files"; lines.push(`- ${limitReached} ${item} skipped (limit ${context === "folder scan" ? "discovery cap" : FILE_LIMIT} reached).`); hasSkipsOrErrors = true; }
  if (permissionDenied > 0) { lines.push(`- ${permissionDenied} item(s) SKIPPED DUE TO PERMISSION ERROR.`); hasSkipsOrErrors = true; }
  if (readError > 0) { lines.push(`- ${readError} file(s) SKIPPED DUE TO READ ERROR.`); hasSkipsOrErrors = true; }
  if (!hasSkipsOrErrors) return null;
  const header = context === "folder scan" ? "Some items were skipped during folder scan (this is normal):" : "Some files were skipped during individual add:";
  return header + '\n' + lines.join('\n');
}

async function scanDirectoryForMinimalMetadata(rootHandle) {
  const tops = [];
  const preliminaryMeta = [];
  const rejectionStats = { permissionDenied: 0, readError: 0, limitReached: 0 };
  console.log('[scanMinimalMetadata] Starting for root:', rootHandle.name);
  try {
    for await (const [name, h] of rootHandle.entries()) {
      tops.push(makeTopEntry(name, h.kind));
    }
  } catch (e) {
    console.error('[scanMinimalMetadata] Error listing top entries for root:', rootHandle.name, e);
    rejectionStats.permissionDenied++;
    return { tops, meta: preliminaryMeta, rejectionStats };
  }
  console.log('[scanMinimalMetadata] Top entries:', tops.map(t => t.name));

  const queue = [{ handle: rootHandle, pathPrefix: '' }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !current.handle) continue;
    
    try {
      for await (const [name, childHandle] of current.handle.entries()) {
        const relativePath = current.pathPrefix ? `${current.pathPrefix}/${name}` : name;
        try {
          preliminaryMeta.push({ path: relativePath, kind: childHandle.kind });
          if (childHandle.kind === 'directory') {
            queue.push({ handle: childHandle, pathPrefix: relativePath });
          }
        } catch (err) {
          console.warn(`[scanMinimalMetadata] Inner error for ${relativePath}:`, err.name);
          rejectionStats.readError++;
        }
      }
    } catch (dirError) {
        if (dirError.name === 'NotAllowedError') rejectionStats.permissionDenied++;
        else rejectionStats.readError++;
        console.warn(`[scanMinimalMetadata] FS error iterating dir ${current.pathPrefix || rootHandle.name}:`, dirError.name);
    }
  }
  console.log('[scanMinimalMetadata] Complete. Preliminary meta items found:', preliminaryMeta.length);
  return { tops, meta: preliminaryMeta, rejectionStats };
}

async function processAndStageSelectedFiles(state, isSecondary = false) {
  const root = isSecondary ? state.secondaryRoot : state.root;
  const meta = isSecondary ? state.secondaryMeta : state.meta;
  const selected = isSecondary ? state.secondarySelected : state.selected;
  
  const out = [];
  const rejectionStats = { tooLarge: 0, tooLong: 0, unsupportedType: 0, readError: 0, permissionDenied: 0, limitReached: 0 };
  let filesProcessedCount = 0;

  if (!root || !meta || !selected) return { stagedFiles: out, rejectionStats };
  console.log('[processAndStage] Processing selected top-level items:', Array.from(selected));

  const processingQueue = [];

  for (const topLevelName of selected) {
    const topLevelMetaItem = meta.find(pm => pm.path === topLevelName);
    if (topLevelMetaItem) {
      try {
        if (topLevelMetaItem.kind === 'file') {
          processingQueue.push({ handle: await root.getFileHandle(topLevelMetaItem.path, { create: false }), path: topLevelMetaItem.path, kind: 'file' });
        } else if (topLevelMetaItem.kind === 'directory') {
          processingQueue.push({ handle: await root.getDirectoryHandle(topLevelMetaItem.path, { create: false }), path: topLevelMetaItem.path, kind: 'directory' });
        }
      } catch (e) {
        console.error(`[processAndStage] Could not get initial handle for: ${topLevelMetaItem.path}`, e);
        rejectionStats.readError++;
      }
    }
  }
  console.log('[processAndStage] Initial processing queue size:', processingQueue.length);

  while (processingQueue.length > 0) {
    if (out.length >= FILE_LIMIT) {
      rejectionStats.limitReached += processingQueue.length;
      console.log('[processAndStage] File limit for staging reached. Remaining queue:', processingQueue.length);
      break;
    }
    const { handle: currentHandle, path: currentItemPath, kind: currentItemKind } = processingQueue.shift();
    if (!currentHandle) { console.warn(`[processAndStage] Null handle encountered for path: ${currentItemPath}`); continue; }

    try {
      if (currentItemKind === 'file') {
        filesProcessedCount++;
        const file = await currentHandle.getFile();
        if (file.size > MAX_TEXT_FILE_SIZE) { rejectionStats.tooLarge++; continue; }
        if (!isTextLike(file)) { rejectionStats.unsupportedType++; continue; }
        const text = await file.text();
        if (text.length > MAX_CHAR_LEN) { rejectionStats.tooLong++; continue; }
        const fileName = currentItemPath.substring(currentItemPath.lastIndexOf('/') + 1);
        out.push(makeStagedFile(currentItemPath, file.size, file.type, text, !isSecondary, fileName, root.name));
      } else if (currentItemKind === 'directory') {
        for await (const entry of currentHandle.values()) {
          const entryPath = `${currentItemPath}/${entry.name}`;
          processingQueue.push({ handle: entry, path: entryPath, kind: entry.kind });
        }
      }
    } catch (e) {
      console.error(`[processAndStage] Error processing item ${currentItemPath}:`, e.name, e.message);
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') rejectionStats.permissionDenied++;
      else if (e.name === 'NotFoundError') rejectionStats.readError++;
      else rejectionStats.readError++;
    }
  }
  console.log('[processAndStage] Staging complete. Staged files created:', out.length, "Attempted to process:", filesProcessedCount);
  return {stagedFiles: out, rejectionStats};
}


export default function CodebaseImporter({
  onFilesChange, toastFn, onAddImage, onAddPDF, settings,
  onProjectRootChange, currentProjectRootNameFromBuilder
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

  const performScan = useCallback(async (handleToScan, context, isSecondary = false) => {
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
        const { root, secondaryRoot } = stateRef.current;
        const currentRoot = isSecondary ? secondaryRoot : root;

        if (currentRoot?.name === handleToScan.name) {
            dispatch({ type: 'SCAN_DONE', tops, meta });
            const msg = formatRejectionMessage(rejectionStats, `folder scan on ${context}`);
            if (msg) toastFn?.(msg, 15000);
        } else {
            console.log(`[performScan] Scan for ${handleToScan.name} completed, but state/root changed. Discarding. Current Root: ${currentRoot?.name}`);
        }
    } catch (err) {
        console.error(`[performScan] Error during scan for ${handleToScan.name} (context: ${context}):`, err);
        const { root } = stateRef.current;
        if (root?.name === handleToScan.name) {
            dispatch({ type: 'CLEAR_ALL' }); onProjectRootChange?.(null); clearIDBRoot().catch(console.warn);
        }
        toastFn?.(`Error scanning directory (${context}): ` + err.message, 5000);
    } finally {
        scanInProgressRef.current = false;
    }
  }, [toastFn, onProjectRootChange]);

  useEffect(() => { // SyncEffect
    const currentEffectRootName = impState.root?.name;
    console.log('[SyncEffect] Running. ParentRootName:', currentProjectRootNameFromBuilder, 'ImporterState:', impState.tag, 'CurrentImporterRootName:', currentEffectRootName, 'InitialLoadAttempted:', initialLoadAttemptedRef.current, 'ScanInProgress:', scanInProgressRef.current);

    // Scenario 1: Parent indicates no project root is active
    if (currentProjectRootNameFromBuilder === null) {
      if (impState.root) {
        console.log('[SyncEffect] SCENARIO 1A: Parent cleared project root. Resetting importer.');
        clearIDBRoot().catch(console.warn);
        dispatch({ type: 'CLEAR_ALL' });
      } else if (!impState.root && (impState.tag !== 'IDLE' && impState.tag !== 'STAGED')) {
        console.log('[SyncEffect] SCENARIO 1B: Parent wants no root, and importer is in a root-dependent intermediate state. Resetting.');
        dispatch({ type: 'CLEAR_ALL' });
      }
      initialLoadAttemptedRef.current = true;
      return;
    }

    // Scenario 2: Parent specifies a root name
    if (currentProjectRootNameFromBuilder) {
      if (currentEffectRootName === currentProjectRootNameFromBuilder && (impState.tag === 'FILTER' || impState.tag === 'STAGED')) {
        console.log('[SyncEffect] SCENARIO 2A: Importer already has correct root and stable state.');
        initialLoadAttemptedRef.current = true;
        return;
      }

      if (impState.tag === 'SCANNING' && currentEffectRootName === currentProjectRootNameFromBuilder) {
          console.log('[SyncEffect] SCENARIO 2B: State is SCANNING for the target root. Triggering performScan if not already in progress.');
          if (impState.root) performScan(impState.root, "SyncEffect - state was SCANNING");
          return;
      }
      
      if (currentEffectRootName !== currentProjectRootNameFromBuilder || impState.tag === 'IDLE') {
        console.log('[SyncEffect] SCENARIO 2C: Parent wants root:', currentProjectRootNameFromBuilder, '. Current importer root:', currentEffectRootName, 'State:', impState.tag, '. Attempting to load/set.');
        initialLoadAttemptedRef.current = true;
        loadRoot().then(handleFromIDB => {
          if (handleFromIDB?.name === currentProjectRootNameFromBuilder) {
            console.log('[SyncEffect] SCENARIO 2C: Loaded matching root from IDB:', handleFromIDB.name);
            dispatch({ type: 'PICK_ROOT', handle: handleFromIDB });
          } else {
            console.log('[SyncEffect] SCENARIO 2C: No matching root in IDB for', currentProjectRootNameFromBuilder, '. Importer to IDLE.');
            if (handleFromIDB) clearIDBRoot().catch(console.warn);
            if (impState.tag !== 'IDLE') dispatch({ type: 'CLEAR_ALL' });
          }
        }).catch(err => {
          console.warn('[SyncEffect] SCENARIO 2C: Error in loadRoot():', err);
          if (impState.tag !== 'IDLE') dispatch({ type: 'CLEAR_ALL' });
        });
        return;
      }
    }

    // Scenario 3: Initial mount, no root from parent, try to load from IDB once
    if (!currentProjectRootNameFromBuilder && impState.tag === 'IDLE' && !currentEffectRootName && !initialLoadAttemptedRef.current) {
      console.log('[SyncEffect] SCENARIO 3: Initial mount, no parent root. Attempting IDB load.');
      initialLoadAttemptedRef.current = true;
      loadRoot().then(handleFromIDB => {
        if (handleFromIDB) {
          console.log('[SyncEffect] SCENARIO 3: Initial mount: Loaded root from IDB:', handleFromIDB.name);
          onProjectRootChange?.(handleFromIDB.name);
        } else {
          console.log('[SyncEffect] SCENARIO 3: Initial mount: No root in IDB.');
        }
      }).catch(err => console.warn('[SyncEffect] SCENARIO 3: Initial mount: Error loading root:', err));
    }
  }, [currentProjectRootNameFromBuilder, onProjectRootChange, toastFn, impState.tag, impState.root?.name, performScan]);

  useEffect(() => {
    if (impState.tag === 'FILTER' || impState.tag === 'FILTER_SECONDARY') {
        lastCheckedIndexRef.current = null;
    }
  }, [impState.tag]);

  const pickFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { toastFn?.('Directory picker not supported.', 4000); return; }
    setAdding(true);
    try {
      const dirHandle = await window.showDirectoryPicker();
      
      if (impState.tag === 'STAGED' && impState.files.length > 0) {
        dispatch({ type: 'PICK_SECONDARY_ROOT', handle: dirHandle });
        performScan(dirHandle, `secondary scan of ${dirHandle.name}`, true);
      } else {
        await saveRoot(dirHandle);
        if (impState.root?.name === dirHandle.name && (impState.tag === 'FILTER' || impState.tag === 'STAGED')) {
          dispatch({ type: 'RESCAN_ROOT' });
        } else {
          onProjectRootChange?.(dirHandle.name);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') toastFn?.('Folder pick error: ' + e.message, 4000);
    } finally {
      setAdding(false);
    }
  }, [toastFn, onProjectRootChange, impState, performScan]);

  const handleCheckboxChange = useCallback((event, path) => {
    dispatch({ type: 'TOGGLE_SELECT', path: path, desiredState: event.target.checked });
  }, []);

  const beginStagingAndReadTexts = useCallback(async () => {
    const isSecondary = impState.tag === 'FILTER_SECONDARY';
    dispatch({ type: 'BEGIN_STAGING' });
    setAdding(true);
    try {
      const {stagedFiles, rejectionStats} = await processAndStageSelectedFiles(impState, isSecondary);
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
  const isLoadingOperation = adding || phase === 'SCANNING' || phase === 'STAGING' || phase === 'SCANNING_SECONDARY' || phase === 'STAGING_SECONDARY';

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
            const path = `public/images/${crypto.randomUUID()}.webp`;
            const {error:upErr} = await supabase.storage.from('images').upload(path,blob,{contentType:'image/webp', upsert:false});
            if(upErr) throw upErr;
            const {data:pub,error:pubErr} = supabase.storage.from('images').getPublicUrl(path);
            if(pubErr) throw pubErr;
            onAddImage?.({name:file.name, url:pub.publicUrl, revoke:null});
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
            const path = `public/images/${crypto.randomUUID()}.webp`;
            const {error:upErr} = await supabase.storage.from('images').upload(path,blob,{contentType:'image/webp', upsert: false});
            if(upErr) throw upErr;
            const {data:pub,error:pubErr} = supabase.storage.from('images').getPublicUrl(path);
            if(pubErr) throw pubErr;
            onAddImage?.({name,url:pub.publicUrl,revoke:null});
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

  const isFiltering = phase === 'FILTER' || phase === 'FILTER_SECONDARY';
  const currentFilterTops = phase === 'FILTER' ? impState.tops : (phase === 'FILTER_SECONDARY' ? impState.secondaryTops : []);
  const currentFilterSelected = phase === 'FILTER' ? impState.selected : (phase === 'FILTER_SECONDARY' ? impState.secondarySelected : new Set());
  const currentFilterRootName = phase === 'FILTER' ? impState.root?.name : (phase === 'FILTER_SECONDARY' ? impState.secondaryRoot?.name : '');

  return (
    <div className="file-pane-container">
      <h2>Codebase Importer</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '1rem' }}>
        {/* Top Row */}
        <button className="button" onClick={pickFolder} disabled={isLoadingOperation}>
          {phase === 'STAGED' && impState.files.length > 0 ? '+ Add More Folders' : '+ Add Folder'}
        </button>
        <button className="button" onClick={pickTextFilesAndDispatch} disabled={isLoadingOperation}>
          {phase === 'STAGED' && impState.files.length > 0 ? '+ Add More Files' : '+ Add Files'}
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

      {(phase === 'SCANNING' || phase === 'STAGING' || phase === 'SCANNING_SECONDARY' || phase === 'STAGING_SECONDARY') && (
         <div className="analysing-animation-container">
            <span className="analysing-text">{phase.startsWith('SCANNING') ? 'Scanning folder (metadata)...' : 'Processing selected files...'}</span>
            <div className="analysing-dots"><span></span><span></span><span></span></div>
        </div>
      )}
      {isFiltering && (
        <>
          <h3>Select entries to include from '{currentFilterRootName}'</h3>
          <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '4px 0', border: '1px solid var(--border)', borderRadius: '4px', marginBottom: '8px' }}>
            {currentFilterTops.map((t) => (
              <label key={t.name} style={{ display: 'block', margin: '4px 8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={currentFilterSelected.has(t.name)}
                  onChange={e => handleCheckboxChange(e, t.name)}
                  style={{ marginRight: '8px' }} disabled={isLoadingOperation} />
                {t.kind === 'directory' ? '📁' : '📄'} <strong>{t.name}</strong>
              </label>
            ))}
          </div>
          <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
            <button className="button button-accent button-glow"
              disabled={isLoadingOperation || currentFilterSelected.size === 0}
              onClick={beginStagingAndReadTexts} > Pick these Files
            </button>
            <button className="button" style={{background: '#000', color: '#fff'}}
              disabled={isLoadingOperation}
              onClick={() => dispatch({ type: 'BULK_SELECT', paths: currentFilterTops.map(t => t.name), select: true })}
            > Select All </button>
            <button className="button" style={{background: '#000', color: '#fff'}}
              disabled={isLoadingOperation}
              onClick={() => dispatch({ type: 'BULK_SELECT', paths: currentFilterTops.map(t => t.name), select: false })}
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
                <li key={f.id} title={`${f.path} (${f.charCount.toLocaleString()} chars)`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}> 
                  <span>
                    {f.path.length > 50 ? `...${f.path.slice(-47)}` : f.path}
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '8px', fontSize: '0.8em' }}>
                      ({f.charCount.toLocaleString()}&nbsp;chars)
                    </span>
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
          {impState.files.length === 0 && ( <p style={{ color: 'var(--text-secondary)' }}>No text files staged. Add files or select from a folder.</p> )}
        </>
      )}
      {phase === 'IDLE' && !isLoadingOperation && ( <p style={{ color: 'var(--text-secondary)' }}>No text files added yet. Use "+ Add Files" or select a folder.</p> )}
    </div>
  );
}
