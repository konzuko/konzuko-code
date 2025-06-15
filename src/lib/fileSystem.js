// file: src/lib/fileSystem.js
/* -------------------------------------------------------------------------
   File-system helpers used by CodebaseImporter
   – Scans directories, filters files, and stages their content.

   UPDATED
   • `MAX_CUMULATIVE_FILE_SIZE` is now imported from ../config.js
     (was incorrectly pulled from fileTypeGuards.js)
---------------------------------------------------------------------------*/

import { isTextLike, MAX_TEXT_FILE_SIZE, MAX_CHAR_LEN } from './fileTypeGuards.js';
import { FILE_LIMIT, MAX_CUMULATIVE_FILE_SIZE }         from '../config.js';
import { makeStagedFile }                               from '../codeImporter/state.js';

/* -------------------------------------------------------------------------
   formatRejectionMessage
   Returns a human-readable summary of why files were skipped.
---------------------------------------------------------------------------*/
export function formatRejectionMessage(rejectionStats, context = 'folder scan') {
  const {
    tooLarge = 0,
    tooLong = 0,
    unsupportedType = 0,
    limitReached = 0,
    permissionDenied = 0,
    readError = 0,
    cumulativeSizeReached = 0,
  } = rejectionStats;

  const lines = [];
  let hasSkipsOrErrors = false;

  if (tooLarge > 0) {
    lines.push(`- ${tooLarge} file(s) skipped (over ${MAX_TEXT_FILE_SIZE / 1024}KB).`);
    hasSkipsOrErrors = true;
  }
  if (tooLong > 0) {
    lines.push(`- ${tooLong} file(s) skipped (over ${MAX_CHAR_LEN / 1000}k chars).`);
    hasSkipsOrErrors = true;
  }
  if (unsupportedType > 0) {
    lines.push(`- ${unsupportedType} file(s) skipped (not text/code).`);
    hasSkipsOrErrors = true;
  }
  if (limitReached > 0) {
    const item = context === 'folder scan' ? 'entries during scan' : 'files';
    lines.push(
      `- ${limitReached} ${item} skipped (limit ${
        context === 'folder scan' ? 'discovery cap' : FILE_LIMIT
      } reached).`
    );
    hasSkipsOrErrors = true;
  }
  if (cumulativeSizeReached > 0) {
    lines.push(
      `- ${cumulativeSizeReached} file(s) skipped (cumulative size limit of ${
        MAX_CUMULATIVE_FILE_SIZE / (1024 * 1024)
      }MB reached).`
    );
    hasSkipsOrErrors = true;
  }
  if (permissionDenied > 0) {
    lines.push(`- ${permissionDenied} item(s) SKIPPED DUE TO PERMISSION ERROR.`);
    hasSkipsOrErrors = true;
  }
  if (readError > 0) {
    lines.push(`- ${readError} file(s) SKIPPED DUE TO READ ERROR.`);
    hasSkipsOrErrors = true;
  }

  if (!hasSkipsOrErrors) return null;

  const header =
    context === 'folder scan'
      ? 'Some items were skipped during folder scan (this is normal):'
      : 'Some files were skipped during individual add:';
  return header + '\n' + lines.join('\n');
}

/* -------------------------------------------------------------------------
   scanDirectoryForMinimalMetadata
   Walks the directory tree and returns minimal metadata (paths & kind) so
   the UI can let the user choose what to stage without loading file content.
---------------------------------------------------------------------------*/
export async function scanDirectoryForMinimalMetadata(rootHandle) {
  const tops = [];
  const preliminaryMeta = [];
  const rejectionStats = { permissionDenied: 0, readError: 0, limitReached: 0 };

  console.log('[scanMinimalMetadata] Starting for root:', rootHandle.name);

  /* list top-level entries */
  try {
    for await (const [name, h] of rootHandle.entries()) {
      tops.push({ name, kind: h.kind });
    }
  } catch (e) {
    console.error('[scanMinimalMetadata] Error listing top entries:', e);
    rejectionStats.permissionDenied++;
    return { tops, meta: preliminaryMeta, rejectionStats };
  }

  /* BFS walk the directory tree */
  const queue = [{ handle: rootHandle, pathPrefix: '' }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || !current.handle) continue;

    try {
      for await (const [name, childHandle] of current.handle.entries()) {
        const relativePath = current.pathPrefix
          ? `${current.pathPrefix}/${name}`
          : name;
        preliminaryMeta.push({ path: relativePath, kind: childHandle.kind });

        if (childHandle.kind === 'directory') {
          queue.push({ handle: childHandle, pathPrefix: relativePath });
        }
      }
    } catch (dirError) {
      if (dirError.name === 'NotAllowedError') rejectionStats.permissionDenied++;
      else rejectionStats.readError++;
      console.warn(
        `[scanMinimalMetadata] FS error iterating dir ${current.pathPrefix || rootHandle.name}:`,
        dirError.name
      );
    }
  }

  console.log(
    '[scanMinimalMetadata] Complete. Preliminary meta items:',
    preliminaryMeta.length
  );
  return { tops, meta: preliminaryMeta, rejectionStats };
}

/* -------------------------------------------------------------------------
   processAndStageSelectedFiles
   Reads the actual file contents of the user-selected items and creates the
   in-memory “staged files” payload (used later to build the prompt).
---------------------------------------------------------------------------*/
export async function processAndStageSelectedFiles(state) {
  const { root, meta, selected } = state;

  const out = [];
  const rejectionStats = {
    tooLarge: 0,
    tooLong: 0,
    unsupportedType: 0,
    readError: 0,
    permissionDenied: 0,
    limitReached: 0,
    cumulativeSizeReached: 0,
  };
  let cumulativeSize = 0;

  if (!root || !meta || !selected) return { stagedFiles: out, rejectionStats };

  console.log(
    '[processAndStage] Processing selected items:',
    Array.from(selected)
  );

  const queue = [];

  /* Seed the queue with the top-level selections */
  for (const topLevelName of selected) {
    const metaItem = meta.find((m) => m.path === topLevelName);
    if (!metaItem) continue;

    try {
      const handle =
        metaItem.kind === 'file'
          ? await root.getFileHandle(metaItem.path, { create: false })
          : await root.getDirectoryHandle(metaItem.path, { create: false });

      queue.push({ handle, path: metaItem.path, kind: metaItem.kind });
    } catch (e) {
      console.error(`[processAndStage] Cannot access ${metaItem.path}:`, e);
      rejectionStats.readError++;
    }
  }

  /* BFS over queue */
  while (queue.length > 0) {
    if (out.length >= FILE_LIMIT) {
      rejectionStats.limitReached += queue.length;
      console.log('[processAndStage] FILE_LIMIT reached – stopping.');
      break;
    }

    const { handle, path, kind } = queue.shift();
    if (!handle) continue;

    try {
      if (kind === 'file') {
        const file = await handle.getFile();

        /* cumulative size gate */
        if (cumulativeSize + file.size > MAX_CUMULATIVE_FILE_SIZE) {
          rejectionStats.cumulativeSizeReached++;
          continue;
        }

        /* per-file gates */
        if (file.size > MAX_TEXT_FILE_SIZE) {
          rejectionStats.tooLarge++;
          continue;
        }
        if (!isTextLike(file)) {
          rejectionStats.unsupportedType++;
          continue;
        }

        const text = await file.text();
        if (text.length > MAX_CHAR_LEN) {
          rejectionStats.tooLong++;
          continue;
        }

        out.push(
          makeStagedFile(
            path,
            file.size,
            file.type,
            text,
            true,
            file.name,
            root.name
          )
        );
        cumulativeSize += file.size;
      } else if (kind === 'directory') {
        /* enqueue children */
        for await (const entry of handle.values()) {
          queue.push({
            handle: entry,
            path: `${path}/${entry.name}`,
            kind: entry.kind,
          });
        }
      }
    } catch (e) {
      console.error(`[processAndStage] Error processing ${path}:`, e);
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        rejectionStats.permissionDenied++;
      else rejectionStats.readError++;
    }
  }

  console.log(
    `[processAndStage] Done. Staged ${out.length} file(s), cumulative size ${(cumulativeSize / 1024).toFixed(
      1
    )} KB`
  );
  return { stagedFiles: out, rejectionStats };
}
