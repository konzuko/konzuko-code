/* src/CodebaseImporter.jsx
   ------------------------------------------------------------
   Handles:
   • Text/code file selection (+Add Files)
   • Folder scanning with FILTER step (+Add Folder) - items default to unselected
   • Image selection, compression (1024px WebP), and Supabase upload (+Add Images)
   • Image paste from clipboard, compression, and Supabase upload (Paste Image)
   • PDF selection and direct browser upload to Gemini Files API using user's key (+Add PDF)
------------------------------------------------------------*/
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { GoogleGenAI } from "@google/genai";

import { loadRoot, saveRoot, clearRoot, getFullPath } from './lib/fsRoot.js';
import {
  isTextLike,
  MAX_TEXT_FILE_SIZE,
  MAX_CHAR_LEN
} from './lib/fileTypeGuards.js';
import { FILE_LIMIT }             from './config.js';
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

  if (parts.length === 1) {
    return filterMap[parts[0]] === true;
  }

  const topLevelDirInPath = parts[0];
  return filterMap[topLevelDirInPath] === true;
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
  const [initialScanResults, setInitialScanResults] = useState([]);
  const lastCheckedIndexRef = useRef(null);

  // Effect A: Handles changes to currentProjectRootNameFromBuilder (parent-driven root changes)
  // and syncs internal project state.
  useEffect(() => {
    let live = true;
    if (currentProjectRootNameFromBuilder === null && projectRoot !== null) {
      // Parent wants to clear the project root.
      console.log('[CodebaseImporter Effect A] Parent signaled project root clear. Current internal projectRoot:', projectRoot?.name);

      // Before clearing internal root state, remove any files from the parent's list
      // that were part of this project. This should only happen once when the
      // transition to a null root is detected from the parent.
      const projectFilesExist = files.some(f => f.insideProject);
      if (projectFilesExist) {
        console.log('[CodebaseImporter Effect A] Removing project-specific files from parent list. Current files prop length:', files.length);
        onFilesChange(files.filter(f => !f.insideProject));
      } else {
        console.log('[CodebaseImporter Effect A] No project-specific files found in current files prop to remove.');
      }

      clearRoot()
        .catch(err => console.warn("CodebaseImporter: Failed to clear root from IDB during reset via prop", err))
        .finally(() => {
          if (live) {
            console.log('[CodebaseImporter Effect A] Setting internal project states to null/initial.');
            setProjectRoot(null);
            setTopEntries([]);
            setEntryFilter({});
            setInitialScanResults([]);
            setStep('FILTER');
            lastCheckedIndexRef.current = null;
          }
        });
    } else if (currentProjectRootNameFromBuilder && (!projectRoot || projectRoot.name !== currentProjectRootNameFromBuilder)) {
      // Parent has specified a project root, and we either don't have one internally, or it's different.
      // Attempt to load it. This primarily handles cases where the parent re-establishes a root
      // or on initial load if parent has a root name but this component doesn't have the handle yet.
      console.log('[CodebaseImporter Effect A] Parent specified root, attempting to load/sync:', currentProjectRootNameFromBuilder, 'Current internal projectRoot:', projectRoot?.name);
      loadRoot().then(h => {
        if (live) {
          if (h && h.name === currentProjectRootNameFromBuilder) {
            console.log('[CodebaseImporter Effect A] Loaded matching root from IDB:', h.name);
            setProjectRoot(h);
            // Note: This doesn't re-scan. Scanning is typically part of `addFolder`.
            // If `topEntries` etc. need to be repopulated, that's a more complex sync,
            // usually triggered by user action (`addFolder`) or if `initialScanResults` are empty.
          } else if (h && h.name !== currentProjectRootNameFromBuilder) {
            // IDB has a root, but it's not what the parent wants. Clear IDB.
            console.log('[CodebaseImporter Effect A] Mismatch between parent root and IDB root. Clearing IDB. IDB root:', h.name);
            clearRoot().finally(() => {
              if (live) setProjectRoot(null); // No valid root to set internally
            });
          } else if (!h) {
            // No root in IDB, and parent wants one. Parent should trigger `addFolder` if scan is needed.
            console.log('[CodebaseImporter Effect A] No root in IDB, parent wants one. Setting internal projectRoot to null.');
            setProjectRoot(null);
          }
        }
      }).catch((err) => {
        console.warn('[CodebaseImporter Effect A] Error loading root from IDB:', err);
        if (live) setProjectRoot(null);
      });
    }
    return () => { live = false; };
  }, [currentProjectRootNameFromBuilder, projectRoot, files, onFilesChange]); // `files` and `onFilesChange` are needed for the conditional call.

  // Effect for initial load of projectRoot from IDB if not driven by prop from parent
  // This ensures that if the app reloads, CodebaseImporter tries to pick up an existing root.
  useEffect(() => {
    let live = true;
    if (!currentProjectRootNameFromBuilder && !projectRoot) { // Only if parent hasn't specified and we don't have one
        console.log('[CodebaseImporter InitialMountEffect] Attempting to load root from IDB.');
        loadRoot().then(h => {
            if (live) {
                if (h) {
                    console.log('[CodebaseImporter InitialMountEffect] Loaded root from IDB:', h.name);
                    setProjectRoot(h);
                    onProjectRootChange?.(h.name); // Inform parent
                    // If a root is loaded, we might want to re-populate topEntries and initialScanResults
                    // This is complex because `addFolder` normally handles scanning.
                    // For now, this effect primarily syncs `projectRoot` and informs parent.
                    // A full re-scan might be too heavy for an initial load effect without user action.
                    // Consider if `addFolder` logic needs to be callable to re-process an existing handle.
                } else {
                    console.log('[CodebaseImporter InitialMountEffect] No root found in IDB.');
                    onProjectRootChange?.(null); // Ensure parent knows there's no root
                }
            }
        }).catch((err) => {
            console.warn('[CodebaseImporter InitialMountEffect] Error loading root from IDB:', err);
            if (live) {
                onProjectRootChange?.(null);
            }
        });
    }
    return () => { live = false; };
  }, [onProjectRootChange, currentProjectRootNameFromBuilder, projectRoot]);


  // Effect B: Merges files based on internal filters and updates parent (onFilesChange)
  // This effect is primarily for when the user interacts with the filter checkboxes for a loaded project.
  useEffect(() => {
    console.log('[CodebaseImporter Effect B] Checking conditions. Props/States:', {
        filesPropLength: files.length, // from parent
        currentProjectRootNameFromBuilder, // from parent
        internalStep: step,
        internalProjectRootName: projectRoot ? projectRoot.name : null,
        internalInitialScanResultsLength: initialScanResults.length,
        internalTopEntriesLength: topEntries.length,
        internalEntryFilterKeys: Object.keys(entryFilter).length,
    });

    // Guard:
    // 1. If parent is signaling a full reset (currentProjectRootNameFromBuilder is null), bail out.
    //    Effect A is responsible for handling the reset, including clearing project-specific files from parent.
    // 2. If there's no internal projectRoot (folder handle), bail out.
    // 3. If not in the 'FILES' step (i.e., still in 'FILTER' step of selecting top-level entries), bail out.
    // 4. If there are no initial scan results AND no top-level entries (empty or uninitialized project), bail out.
    if (currentProjectRootNameFromBuilder === null ||
        !projectRoot ||
        step !== 'FILES' ||
        (initialScanResults.length === 0 && topEntries.length === 0)) {
        console.log('[CodebaseImporter Effect B] Bailing out due to guard conditions.');
        if (!projectRoot && initialScanResults.length > 0) {
            // This ensures that if projectRoot is cleared (e.g., by "Clear List" button or Effect A),
            // we don't use stale initialScanResults from a previous project.
            console.log('[CodebaseImporter Effect B] Clearing stale initialScanResults as projectRoot is null.');
            setInitialScanResults([]);
        }
        return;
    }

    console.log('[CodebaseImporter Effect B] Proceeding to merge files.');
    const userFilteredProjectFiles = initialScanResults.filter(f => isIncluded(f.fullPath, entryFilter));
    const nonProjectFiles = files.filter(f => !f.insideProject); // Files from parent not part of current project
    const combinedListBeforeFinalLimit = mergeFiles([], nonProjectFiles);
    const remainingSlotsForProjectFiles = FILE_LIMIT - combinedListBeforeFinalLimit.length;
    let finalProjectFilesToMerge = userFilteredProjectFiles;
    let countExcludedByFileLimit = 0;

    if (remainingSlotsForProjectFiles < userFilteredProjectFiles.length) {
        if (remainingSlotsForProjectFiles > 0) {
            finalProjectFilesToMerge = userFilteredProjectFiles.slice(0, remainingSlotsForProjectFiles);
            countExcludedByFileLimit = userFilteredProjectFiles.length - finalProjectFilesToMerge.length;
        } else {
            finalProjectFilesToMerge = [];
            countExcludedByFileLimit = userFilteredProjectFiles.length;
        }
    }

    const newCompleteFileList = mergeFiles(combinedListBeforeFinalLimit, finalProjectFilesToMerge);
    const currentFilesString = files.map(f => `${f.fullPath}|${f.checksum}`).join(',');
    const newFilesString = newCompleteFileList.map(f => `${f.fullPath}|${f.checksum}`).join(',');

    if (newFilesString !== currentFilesString) {
        console.log('[CodebaseImporter Effect B] Files list changed. Calling onFilesChange with:', newCompleteFileList.map(f=>f.fullPath));
        onFilesChange(newCompleteFileList);

        const numSelectedProjectFiles = finalProjectFilesToMerge.length;
        if (numSelectedProjectFiles > 0) {
            let message = `${numSelectedProjectFiles} project file${numSelectedProjectFiles > 1 ? 's' : ''} picked.`;
            if (countExcludedByFileLimit > 0) {
                message += ` ${countExcludedByFileLimit} more were available from selection but excluded by file limit.`;
            }
            toastFn?.(message, 4000);
        } else if (Object.values(entryFilter).some(v => v === true) && numSelectedProjectFiles === 0 && initialScanResults.length > 0) {
            toastFn?.('Selection resulted in 0 project files. Try selecting other items.', 4000);
        } else if (files.length > newCompleteFileList.length && countExcludedByFileLimit === 0 && initialScanResults.length === (userFilteredProjectFiles.length)) {
            const actualRemoved = files.length - newCompleteFileList.length;
            if (actualRemoved > 0) {
                 toastFn?.(`Removed ${actualRemoved} duplicate item${actualRemoved > 1 ? 's' : ''}.`, 3000);
            }
        }
    } else {
        console.log('[CodebaseImporter Effect B] Files list did not change. Not calling onFilesChange.');
    }
  }, [
    entryFilter, step, projectRoot, topEntries, files, onFilesChange, toastFn, initialScanResults,
    currentProjectRootNameFromBuilder // Added to ensure this effect respects parent's reset signal
  ]);


  const clearAll = useCallback(() => {
    if (!files.length && !projectRoot && topEntries.length === 0 && Object.keys(entryFilter).length === 0 && initialScanResults.length === 0) return;
    if (!confirm('Remove all selected files and clear project root?')) return;

    clearRoot().then(() => {
      setProjectRoot(null);
      onProjectRootChange?.(null); // Signal parent that root is gone
    }).catch(err => console.error("Error clearing root from IDB:", err));

    setEntryFilter({});
    setTopEntries([]);
    setInitialScanResults([]);
    setStep('FILTER');
    onFilesChange([]); // Directly tell parent the list is empty
    lastCheckedIndexRef.current = null;
  }, [files.length, projectRoot, topEntries.length, Object.keys(entryFilter).length, initialScanResults.length, onFilesChange, onProjectRootChange]);


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
          rejectionStats.count++;
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
            if (!currentFileRejected) rejectionStats.count++;
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
      let fileProcessedForCounting = false;

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
        if (!fileProcessedForCounting) {
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
    setAdding(true);
    try {
      setEntryFilter({});
      setTopEntries([]);
      setInitialScanResults([]);
      setStep('FILTER');
      lastCheckedIndexRef.current = null;

      const dirHandle = await window.showDirectoryPicker();

      setProjectRoot(dirHandle);
      onProjectRootChange?.(dirHandle.name); // Inform parent about the new root
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
      setInitialScanResults(allScannedCandidates);

      const freshMap = {};
      tops.forEach(e => { freshMap[e.name] = false; });
      setEntryFilter(freshMap);

      // After adding a folder, we don't immediately push files to parent.
      // The user needs to select entries and click "Pick these Files" (which sets step='FILES').
      // Effect B will then handle merging and calling onFilesChange.
      // However, we should clear any existing non-project files from the parent
      // if the user is now focusing on a new project folder.
      // Or, preserve them? Current merge logic in Effect B preserves nonProjectFiles.
      // For now, let's ensure `files` prop (which contains nonProjectFiles) is considered by Effect B.
      // No direct onFilesChange([]) here, let user interaction via filter drive it.
      // If there were previous non-project files, they will be shown alongside the new filter UI.

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
  }, [files, onFilesChange, onProjectRootChange, toastFn]); // `files` is needed if we decide to clear non-project files here.

  const handleCheckboxChange = useCallback((event, name, index) => {
    const { checked } = event.target;
    let newFilterState = { ...entryFilter };

    if (event.shiftKey && lastCheckedIndexRef.current !== null && lastCheckedIndexRef.current !== index) {
        const start = Math.min(lastCheckedIndexRef.current, index);
        const end = Math.max(lastCheckedIndexRef.current, index);
        for (let i = start; i <= end; i++) {
            if (topEntries[i]) {
                newFilterState[topEntries[i].name] = checked;
            }
        }
    } else {
        newFilterState[name] = checked;
    }
    setEntryFilter(newFilterState);
    lastCheckedIndexRef.current = index;
  }, [entryFilter, topEntries]);


  const handleAddImages = useCallback(async () => {
    if (!window.showOpenFilePicker) {
        toastFn?.('File picker is not supported in this browser.', 4000);
        return;
    }
    let handles;
    try {
        setAdding(true);
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
        setAdding(false);
        return;
    }

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
        setAdding(true);
        handles = await window.showOpenFilePicker({
            multiple: true,
            types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
        });
    } catch (pickerErr) {
        if (pickerErr.name !== 'AbortError') {
            toastFn?.('PDF picker error: ' + pickerErr.message, 4000);
        }
        setAdding(false);
        return;
    }

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
          {adding && (
            <div className="analysing-animation-container">
              <span className="analysing-text">Analysing project files</span>
              <div className="analysing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          )}
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '4px 0',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            marginBottom: '8px'
          }}>
            {topEntries.map(({ name, kind }, index) => (
              <label key={name} style={{ display: 'block', margin: '4px 8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={entryFilter[name] === true}
                  onChange={e => handleCheckboxChange(e, name, index)}
                  style={{ marginRight: '8px' }}
                  disabled={adding}
                />
                {kind === 'directory' ? '📁' : '📄'} <strong>{name}</strong>
              </label>
            ))}
          </div>
          <button
            className="button button-accent button-glow"
            style={{ marginTop: 8 }}
            onClick={() => setStep('FILES')}
            disabled={adding}
          >
            { adding ? 'Analysing…' : 'Pick these Files' }
          </button>
        </div>
      )}
      {(step === 'FILES' || (step === 'FILTER' && (!projectRoot || topEntries.length === 0))) && (
        <>
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
            <p style={{ color: 'var(--text-secondary)' }}>No text files added yet. Use the buttons above or select items from a chosen folder.</p>
          )}
           {files.length === 0 && step === 'FILES' && projectRoot && topEntries.length > 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>No top-level items selected from '{projectRoot.name}'. Check some boxes and click "Pick these Files".</p>
          )}
        </>
      )}
    </div>
  );
}
