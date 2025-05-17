/*  src/lib/fsRoot.js  – unchanged  */
import { get, set, del } from 'idb-keyval';

const KEY = 'konzuko-project-root';

/* ─── load / save / clear ─── */
export async function loadRoot() {
  const h = await get(KEY);
  if (!h) return null;
  try {
    let p = await h.queryPermission({ mode: 'read' });
    if (p === 'prompt') p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') { await del(KEY); return null; }
    return h;
  } catch { await del(KEY); return null; }
}
export const saveRoot  = h => set(KEY, h);
export const clearRoot = () => del(KEY);

/* ─── relative path helper ─── */
export async function getFullPath(fileHandle, rootHandle) {
  if (rootHandle) {
    try {
      const rel = await rootHandle.resolve(fileHandle);
      if (rel) return { fullPath: rel.join('/'), insideProject: true };
    } catch {}
  }
  return { fullPath: fileHandle.name, insideProject: false };
}
