/* src/FilePane.jsx
   ------------------------------------------------------------
   Duplicate-basename collisions now get a 6-char checksum
   suffix and a short explanatory note.
------------------------------------------------------------*/
import { useState, useCallback, useEffect } from 'preact/hooks';
import { loadRoot, saveRoot, clearRoot, getFullPath } from './lib/fsRoot.js';
import { isTextLike } from './lib/fileTypeGuards.js';
import { checksum32  } from './lib/checksum.js';

const FILE_LIMIT = 500;

/* ── helpers ─────────────────────────────────────────── */
const NOTE =
  'checksum suffix added because this file is named exactly the same as another, yet its content is different';

const hex6 = ck => ck.toString(16).padStart(8, '0').slice(0, 6);

function withHash(path, ck, taken) {
  const m = path.match(/^(.*?)(\.[^.]+)?$/);          // stem/ext
  const stem = m[1], ext = m[2] || '';
  let name = `${stem}.${hex6(ck)}${ext}`;
  if (!taken.has(name)) return name;
  let i = 1;
  while (taken.has(`${name}(${i})`)) i++;
  return `${name}(${i})`;
}

/* merge with checksum‐suffix rule */
function mergeFiles(existing = [], incoming = []) {
  const taken = new Map();   // fullPath → Set<checksum>
  const out   = [...existing];

  existing.forEach(f => {
    (taken.get(f.fullPath) || taken.set(f.fullPath, new Set()).get(f.fullPath))
      .add(f.checksum);
  });

  for (const f of incoming) {
    if (out.length >= FILE_LIMIT) break;

    const set = taken.get(f.fullPath);
    if (!set) {                           // brand-new
      taken.set(f.fullPath, new Set([f.checksum]));
      out.push(f);
      continue;
    }
    if (set.has(f.checksum)) {            // exact duplicate
      out.push(f);
      continue;
    }
    // name clash, diff content → rename
    const newPath = withHash(f.fullPath, f.checksum, taken);
    taken.set(newPath, new Set([f.checksum]));
    out.push({ ...f, fullPath: newPath, note: NOTE });
  }
  return out;
}

/* ── component ───────────────────────────────────────── */
export default function FilePane({ files = [], onFilesChange, onSkip }) {
  const [adding, setAdding]           = useState(false);
  const [projectRoot, setProjectRoot] = useState(null);

  /* restore root */
  useEffect(() => {
    let live = true;
    loadRoot().then(h => { if (live) setProjectRoot(h); });
    return () => { live = false; };
  }, []);

  /* clear all */
  const clearAll = () => {
    if (!files.length) return;
    if (!confirm('Remove all selected files?')) return;
    clearRoot(); setProjectRoot(null); onFilesChange([]);
  };

  /* +Add Files */
  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) { alert('File picker unsupported'); return; }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple:true });
      const batch   = [];
      let skipped   = 0;

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) { skipped++; continue; }
        const fh = h, f = await fh.getFile();
        if (!isTextLike(f)) { skipped++; continue; }

        const text = await f.text();
        const ck   = checksum32(text);
        const { fullPath, insideProject } =
          await getFullPath(fh, projectRoot || null);

        batch.push({ fullPath, text, checksum: ck, insideProject });
      }
      if (skipped) onSkip?.(skipped);
      onFilesChange(mergeFiles(files, batch));
    } catch (err) {
      if (err.name !== 'AbortError') alert('File pick error: '+err.message);
    } finally { setAdding(false); }
  }, [files, onFilesChange, onSkip, projectRoot]);

  /* recurse directory */
  async function scanDir(handle, out, stats, root) {
    for await (const [, h] of handle.entries()) {
      if (out.length >= FILE_LIMIT) { stats.skipped++; continue; }
      try {
        if (h.kind === 'file') {
          const fh = h, f = await fh.getFile();
          if (!isTextLike(f)) { stats.skipped++; continue; }
          const text = await f.text();
          const ck   = checksum32(text);
          const { fullPath, insideProject } = await getFullPath(fh, root);
          out.push({ fullPath, text, checksum: ck, insideProject });
        } else if (h.kind === 'directory') {
          await scanDir(h, out, stats, root);
        }
      } catch { stats.skipped++; }
    }
  }

  /* +Add Folder */
  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { alert('Directory picker unsupported'); return; }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      if (!projectRoot) { await saveRoot(dirHandle); setProjectRoot(dirHandle); }

      const batch = [], stats = { skipped:0 };
      await scanDir(dirHandle, batch, stats, dirHandle);
      if (stats.skipped) onSkip?.(stats.skipped);
      onFilesChange(mergeFiles(files, batch));
    } catch (err) {
      if (err.name !== 'AbortError') alert('Folder pick error: '+err.message);
    } finally { setAdding(false); }
  }, [projectRoot, files, onFilesChange, onSkip]);

  /* UI */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {projectRoot && (
        <div style={{ marginBottom:8,fontSize:'0.85rem',opacity:0.8 }}>
          Root: <code>{projectRoot.name}</code>
        </div>
      )}

      <div style={{ display:'flex',gap:8,marginBottom:'1rem' }}>
        <button className="button" onClick={addFiles}  disabled={adding}>+ Add Files</button>
        <button className="button" onClick={addFolder} disabled={adding}>+ Add Folder</button>
        <button
          className="button"
          onClick={clearAll}
          disabled={adding||!files.length}
          style={files.length?{background:'#b71c1c',color:'#fff'}:{}}
        >Clear List</button>
      </div>

      <strong>{files.length} / {FILE_LIMIT} files selected</strong>

      {!!files.length && (
        <ul className="file-pane-filelist">
          {files.map((f,i)=>(
            <li
              key={`${f.fullPath}-${i}`}
              style={{position:'relative'}}
              title={
                f.note ? `${f.fullPath}\n${f.note}`
                : f.insideProject
                  ? f.fullPath
                  : '⚠ Outside project root — basename fallback'
              }
            >
              {f.insideProject ? f.fullPath : '⚠ '+f.fullPath}
              <button
                className="remove-file-btn"
                style={{
                  position:'absolute',top:2,right:4,
                  background:'none',border:'none',
                  color:'#ff7373',cursor:'pointer',
                  fontWeight:'bold',fontSize:'1rem'
                }}
                title="Remove"
                onClick={()=>onFilesChange(files.filter((_,j)=>j!==i))}
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
