/* src/FilePane.jsx */

import { useState, useCallback } from 'preact/hooks';
import { isTextLike }            from './lib/fileTypeGuards.js';

const FILE_LIMIT = 500;

/* de-dupe by fullPath */
function dedupeByPath(arr = []) {
  const seen = new Set();
  return arr.filter(f => {
    if (seen.has(f.fullPath)) return false;
    seen.add(f.fullPath);
    return true;
  });
}

export default function FilePane({ files = [], onFilesChange, onSkip }) {
  const [adding, setAdding] = useState(false);

  const merge = useCallback(batch => {
    const merged = dedupeByPath([...files, ...batch]).slice(0, FILE_LIMIT);
    onFilesChange(merged);
  }, [files, onFilesChange]);

  /* ───────── add files ───────── */
  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) { alert('File picker unsupported'); return; }
    try {
      setAdding(true);
      const handles = await window.showOpenFilePicker({ multiple:true });
      const batch   = [];
      let skipped   = 0;

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) { skipped++; continue; }
        const f = await h.getFile();
        if (!isTextLike(f)) { skipped++; continue; }
        const text = await f.text();
        batch.push({ fullPath: f.name, text });
      }
      if (skipped) onSkip?.(skipped);
      merge(batch);
    } catch (err) {
      if (err.name !== 'AbortError') alert('Failed to pick files: ' + err.message);
    } finally { setAdding(false); }
  }, [files, merge, onSkip]);

  /* ───────── add folder ───────── */
  async function scanDir(handle, prefix='', out=[], stats={ skipped:0 }) {
    for await (const [name, h] of handle.entries()) {
      if (out.length >= FILE_LIMIT) { stats.skipped++; continue; }   // early guard
      const path = prefix ? `${prefix}/${name}` : name;

      if (h.kind === 'file') {
        const f = await h.getFile();
        if (!isTextLike(f)) { stats.skipped++; continue; }
        const text = await f.text();
        out.push({ fullPath: path, text });
      } else if (h.kind === 'directory') {
        await scanDir(h, path, out, stats);
      }
    }
    return stats;
  }

  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) { alert('Directory picker unsupported'); return; }
    try {
      setAdding(true);
      const dirHandle = await window.showDirectoryPicker();
      const batch = [];
      const stats = await scanDir(dirHandle, dirHandle.name, batch);
      if (stats.skipped) onSkip?.(stats.skipped);
      merge(batch);
    } catch (err) {
      if (err.name !== 'AbortError') alert('Failed to pick folder: ' + err.message);
    } finally { setAdding(false); }
  }, [merge, onSkip]);

  /* ───────── helpers ───────── */
  const removeAt = i => onFilesChange(files.filter((_,j)=>j!==i));
  const clearAll = () => confirm('Remove all selected files?') && onFilesChange([]);

  /* ───────── UI ───────── */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      <div style={{display:'flex',gap:8,marginBottom:'1rem'}}>
        <button className="button" onClick={addFiles}  disabled={adding}>+ Add Files</button>
        <button className="button" onClick={addFolder} disabled={adding}>+ Add Folder</button>
        <button
          className="button"
          onClick={clearAll}
          disabled={adding || !files.length}
          style={files.length ? {background:'#b71c1c',color:'#fff'} : {}}
        >Clear List</button>
      </div>

      <strong>{files.length} / {FILE_LIMIT} files selected</strong>
      {!!files.length && (
        <ul className="file-pane-filelist">
          {files.map((f,i)=>(
            <li key={f.fullPath} style={{position:'relative'}}>
              {f.fullPath}
              <button
                className="remove-file-btn"
                style={{
                  position:'absolute',top:2,right:4,
                  background:'none',border:'none',color:'#ff7373',
                  cursor:'pointer',fontWeight:'bold',fontSize:'1rem'
                }}
                title="Remove"
                onClick={()=>removeAt(i)}
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}