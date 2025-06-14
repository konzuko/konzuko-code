/* src/lib/fileSystem.js */
import { isTextLike, MAX_TEXT_FILE_SIZE, MAX_CHAR_LEN } from './fileTypeGuards.js';
import { FILE_LIMIT } from '../config.js';
import { makeStagedFile } from '../codeImporter/state.js';

export function formatRejectionMessage(rejectionStats, context = "folder scan") {
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

export async function scanDirectoryForMinimalMetadata(rootHandle) {
  const tops = [];
  const preliminaryMeta = [];
  const rejectionStats = { permissionDenied: 0, readError: 0, limitReached: 0 };
  console.log('[scanMinimalMetadata] Starting for root:', rootHandle.name);
  try {
    for await (const [name, h] of rootHandle.entries()) {
      tops.push({ name, kind: h.kind });
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

export async function processAndStageSelectedFiles(state) {
  const { root, meta, selected } = state;
  
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
        out.push(makeStagedFile(currentItemPath, file.size, file.type, text, true, fileName, root.name));
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
