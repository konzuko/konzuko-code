/* src/FilePane.jsx
   ------------------------------------------------------------
   • Top-level checklist shows EVERY entry (dirs + files)
   • Unchecked items are genuinely excluded
   • Scrollable checklist (max-height:200px; overflow-y:auto)
   • “Clear List” resets everything
   • +Add Files and +Add Folder remain interoperable
------------------------------------------------------------*/
import { useState, useCallback, useEffect } from 'preact/hooks'
import { loadRoot, saveRoot, clearRoot, getFullPath } from './lib/fsRoot.js'
import {
  isTextLike,
  MAX_TEXT_FILE_SIZE,
  MAX_CHAR_LEN
} from './lib/fileTypeGuards.js'
import { checksum32 } from './lib/checksum.js'
import Toast          from './components/Toast.jsx'

const FILE_LIMIT = 500

/* ── helpers ─────────────────────────────────────────── */
const NOTE =
  'checksum suffix added because this file is named exactly the same as another, yet its content is different'

function hex6(ck) {
  return ck.toString(16).padStart(8, '0').slice(0, 6)
}

function withHash(path, ck, taken) {
  const m    = path.match(/^(.*?)(\.[^.]+)?$/)
  const stem = m[1], ext = m[2] || ''
  let name = `${stem}.${hex6(ck)}${ext}`
  if (!taken.has(name)) return name
  let i = 1
  while (taken.has(`${name}(${i})`)) i++
  return `${name}(${i})`
}

function mergeFiles(existing = [], incoming = []) {
  const taken = new Map()   // fullPath → Set<checksum>
  const out   = [...existing]

  existing.forEach(f => {
    const s = taken.get(f.fullPath) || new Set()
    s.add(f.checksum)
    taken.set(f.fullPath, s)
  })

  for (const f of incoming) {
    if (out.length >= FILE_LIMIT) break

    const s = taken.get(f.fullPath)
    if (!s) {
      taken.set(f.fullPath, new Set([f.checksum]))
      out.push(f)
      continue
    }
    if (s.has(f.checksum)) {
      out.push(f)
      continue
    }
    // rename on checksum collision
    const newPath = withHash(f.fullPath, f.checksum, taken)
    taken.set(newPath, new Set([f.checksum]))
    out.push({ ...f, fullPath: newPath, note: NOTE })
  }
  return out
}

/* ── filter helper ────────────────────────────────────── */
function isIncluded(fullPath, filterMap) {
  const parts = fullPath.split('/')
  if (parts.length === 1) {
    // root‐level file
    return filterMap[parts[0]] !== false
  }
  for (const dir of parts.slice(0, -1)) {
    if (filterMap[dir] === false) return false
  }
  return true
}

/* =========================================================
   COMPONENT
========================================================= */
export default function FilePane({ files = [], onFilesChange, onSkip }) {
  const [adding, setAdding]           = useState(false)
  const [projectRoot, setProjectRoot] = useState(null)

  // top‐level name → checked?
  const [entryFilter, setEntryFilter] = useState({})
  const [step,        setStep]        = useState('FILTER') // 'FILTER'|'FILES'
  // list of { name, kind } from the folder
  const [topEntries,  setTopEntries]  = useState([])

  /* restore saved root */
  useEffect(() => {
    let live = true
    loadRoot()
      .then(h => { if (live) setProjectRoot(h) })
      .catch(() => {})    // ignore restore errors
    return () => { live = false }
  }, [])

  /* completely clear everything */
  const clearAll = () => {
    if (!files.length) return
    if (!confirm('Remove all selected files?')) return
    clearRoot()
    setProjectRoot(null)
    setEntryFilter({})
    setTopEntries([])
    setStep('FILTER')
    onFilesChange([])
  }

  /* +Add Files (single picker) */
  const addFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      alert('File picker unsupported')
      return
    }
    try {
      setAdding(true)
      const handles = await window.showOpenFilePicker({ multiple:true })
      const batch   = []
      let skipped = 0

      for (const h of handles) {
        if (files.length + batch.length >= FILE_LIMIT) { skipped++; continue }
        const f = await h.getFile()
        if (f.size > MAX_TEXT_FILE_SIZE) { skipped++; continue }
        if (!isTextLike(f))              { skipped++; continue }
        const text = await f.text()
        if (text.length > MAX_CHAR_LEN)  { skipped++; continue }

        const ck = checksum32(text)
        const { fullPath, insideProject } =
          await getFullPath(h, projectRoot || null)
        batch.push({ fullPath, text, checksum: ck, insideProject })
      }

      if (skipped) onSkip?.(skipped)
      const merged = mergeFiles(files, batch)
      onFilesChange(merged)
      setStep('FILES')  // jump to file list view
    } catch (err) {
      if (err.name !== 'AbortError') alert('File pick error: ' + err.message)
    } finally {
      setAdding(false)
    }
  }, [files, onFilesChange, onSkip, projectRoot])

  /* recursive folder scan */
  async function scanDir(handle, out, stats, root) {
    for await (const [, h] of handle.entries()) {
      if (out.length >= FILE_LIMIT) { stats.limit++; continue }
      try {
        if (h.kind === 'file') {
          const f = await h.getFile()
          if (f.size > MAX_TEXT_FILE_SIZE) { stats.bigSize++; continue }
          if (!isTextLike(f))              { stats.binary++;  continue }
          const text = await f.text()
          if (text.length > MAX_CHAR_LEN)  { stats.bigChar++; continue }

          const ck = checksum32(text)
          const { fullPath, insideProject } =
            await getFullPath(h, root)
          out.push({ fullPath, text, checksum: ck, insideProject })
        }
        else if (h.kind === 'directory') {
          await scanDir(h, out, stats, root)
        }
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          stats.perm++
        } else {
          stats.fsErr++
        }
      }
    }
  }

  /* +Add Folder (scan + build & apply fresh filter) */
  const addFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert('Directory picker unsupported')
      return
    }
    try {
      setAdding(true)
      // reset
      setEntryFilter({})
      setTopEntries([])
      setStep('FILTER')

      const dirHandle = await window.showDirectoryPicker()
      if (!projectRoot) {
        await saveRoot(dirHandle)
        setProjectRoot(dirHandle)
      }

      // gather top-level entries
      const tops = []
      for await (const [name, h] of dirHandle.entries()) {
        tops.push({ name, kind: h.kind })
      }
      setTopEntries(tops)

      // scan all files
      const batch = []
      const stats = { bigSize:0, bigChar:0, binary:0, limit:0, perm:0, fsErr:0 }
      await scanDir(dirHandle, batch, stats, dirHandle)

      // build freshMap
      const freshMap = {}
      tops.forEach(e => { freshMap[e.name] = true })

      // sync-apply filter with freshMap
      const merged  = mergeFiles(files, batch)
      const filtered = merged.filter(f => isIncluded(f.fullPath, freshMap))

      // update state + parent
      setEntryFilter(freshMap)
      onFilesChange(filtered)

      // toast skip breakdown
      const skipped =
        stats.bigSize + stats.bigChar + stats.binary +
        stats.limit   + stats.perm    + stats.fsErr
      if (skipped) {
        const parts = []
        if (stats.bigSize) parts.push(`${stats.bigSize} >300 KB`)
        if (stats.bigChar) parts.push(`${stats.bigChar} >50 k chars`)
        if (stats.binary)  parts.push(`${stats.binary} binary`)
        if (stats.limit)   parts.push(`${stats.limit} over limit`)
        if (stats.perm)    parts.push(`${stats.perm} permission denied`)
        if (stats.fsErr)   parts.push(`${stats.fsErr} fs errors`)
        Toast(`Skipped ${skipped} file${skipped>1?'s':''} – ${parts.join(', ')}`)
      }
    } catch (err) {
      if (err.name !== 'AbortError') alert('Folder pick error: ' + err.message)
    } finally {
      setAdding(false)
    }
  }, [projectRoot, files, onFilesChange])

  /* checkbox changes (only in FILES step) */
  useEffect(() => {
    if (step !== 'FILES') return
    const newList = files.filter(f => isIncluded(f.fullPath, entryFilter))
    if (newList.length === files.length) return
    const excluded = files.length - newList.length
    onFilesChange(newList)
    Toast(`Excluded ${excluded} item${excluded>1?'s':''} by filter`)
  }, [entryFilter, files, step, onFilesChange])

  /* ───────── UI ───────── */
  return (
    <div className="file-pane-container">
      <h2>Project Files</h2>

      {projectRoot && (
        <div style={{ marginBottom:8,fontSize:'0.85rem',opacity:0.8 }}>
          Root: <code>{projectRoot.name}</code>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:'1rem' }}>
        <button className="button" onClick={addFiles}  disabled={adding}>
          + Add Files
        </button>
        <button className="button" onClick={addFolder} disabled={adding}>
          + Add Folder
        </button>
        <button
          className="button"
          onClick={clearAll}
          disabled={adding || !files.length}
          style={files.length ? { background:'#b71c1c', color:'#fff' } : {}}
        >
          Clear List
        </button>
      </div>

      {/* STEP 1 – scrollable checklist */}
      {step === 'FILTER' && topEntries.length > 0 && (
        <div>
          <h3>Select entries to include</h3>
          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              padding: '4px 0',
              border: '1px solid var(--border)',
              borderRadius: '4px'
            }}
          >
            {topEntries.map(({ name, kind }) => (
              <label key={name} style={{ display:'block', margin:'4px 8px' }}>
                <input
                  type="checkbox"
                  checked={entryFilter[name] !== false}
                  onChange={e =>
                    setEntryFilter(m => ({ ...m, [name]: e.target.checked }))
                  }
                />{' '}
                {kind === 'directory' ? '📁' : '📄'}{' '}
                <strong>{name}</strong>
              </label>
            ))}
          </div>
          <button
            className="button"
            style={{ marginTop:8 }}
            onClick={() => setStep('FILES')}
          >
            Continue
          </button>
        </div>
      )}

      {/* STEP 2 – file list */}
      {step === 'FILES' && (
        <>
          <strong>{files.length} / {FILE_LIMIT} files selected</strong>
          {!!files.length && (
            <ul className="file-pane-filelist">
              {files.map((f,i) => (
                <li
                  key={`${f.fullPath}-${i}`}
                  style={{ position:'relative' }}
                >
                  {f.note
                    ? <span title={f.note}>{f.fullPath}</span>
                    : f.insideProject
                      ? f.fullPath
                      : '⚠ ' + f.fullPath
                  }
                  <button
                    className="remove-file-btn"
                    style={{
                      position:'absolute', top:2, right:4,
                      background:'none', border:'none',
                      color:'#ff7373', cursor:'pointer',
                      fontWeight:'bold', fontSize:'1rem'
                    }}
                    title="Remove"
                    onClick={() =>
                      onFilesChange(files.filter((_,j) => j!==i))
                    }
                  >×</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
