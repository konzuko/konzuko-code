import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'preact/hooks'
import { encodingForModel } from 'js-tiktoken'
import { LOCALSTORAGE_DEBOUNCE } from './config.js'

/*────────────────────────────  Local-storage w/ debounce ───────────────────*/
function useDebouncedLocalStorage(key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      }
      catch (err) {
        console.warn('localStorage error', err)
      }
    }, delay)
    return () => clearTimeout(id)
  }, [key, value, delay])
  return [value, setValue]
}

export function useSettings() {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey       : '',
    model        : 'gpt-3.5-turbo',
    codeType     : 'javascript',
    showSettings : false,
  })
}

export function useFormData() {
  return useDebouncedLocalStorage('konzuko-form-data', {
    developGoal         : '',
    developFeatures     : '',
    developReturnFormat :
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings     : '',
    developContext      : '',
    fixCode             : '',
    fixErrors           : '',
  })
}

/*──────────────────────────────────────────────────────────────────────────────
  Recursive BFS traversal, using BOTH:
  1) File System Access API → handle.getAsFileSystemHandle().
  2) webkitGetAsEntry → readEntries().
  3) Fallback to item.getAsFile() for browsers w/o directory support.

  The gatherAllDroppedFiles(...) function loops every dropped item, tries BFS
  approach for directories, and adds all discovered File objects into allFiles.
  You can drop multiple directories + single files in a single operation.
──────────────────────────────────────────────────────────────────────────────*/

/** BFS for File System Access API: gather file handles recursively. */
async function bfsTraverseFsHandle(rootHandle, outFiles = []) {
  const queue = [rootHandle]
  while (queue.length) {
    const handle = queue.shift()
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      file.fullPath = file.fullPath || file.name
      outFiles.push(file)
    } else if (handle.kind === 'directory') {
      for await (const [, child] of handle.entries()) {
        if (child.kind === 'file') {
          const file = await child.getFile()
          file.fullPath = `${handle.name}/${file.name}`
          outFiles.push(file)
        } else {
          // Another directory
          child.fullPath = `${handle.name}/`
          queue.push(child)
        }
      }
    }
  }
  return outFiles
}

/** BFS for webkitGetAsEntry: gather FileEntries recursively. */
async function bfsTraverseWebkitEntry(rootEntry, outEntries = []) {
  const queue = [rootEntry]
  while (queue.length > 0) {
    const entry = queue.shift()
    if (entry.isFile) {
      outEntries.push(entry)
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      let batch = await readEntriesPromise(reader)
      while (batch.length > 0) {
        for (const e of batch) { queue.push(e) }
        batch = await readEntriesPromise(reader)
      }
    }
  }
  return outEntries
}

/** readEntries() as a promise, reading one chunk at a time. */
function readEntriesPromise(directoryReader) {
  return new Promise((resolve, reject) => {
    directoryReader.readEntries(resolve, reject)
  })
}

/** Convert a single webkit FileEntry into a proper File object. */
function fileEntryToFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(
      file => {
        // If entry knows its path, store it
        file.fullPath = entry.fullPath || file.name
        resolve(file)
      },
      err => reject(err)
    )
  })
}

/**
 * For each DataTransferItem, BFS-scan directories or read single files.
 * Returns an array of raw File objects across all directories & items.
 */
async function gatherAllDroppedFiles(dataTransferItems) {
  const allFiles = []

  for (let i = 0; i < dataTransferItems.length; i++) {
    const item = dataTransferItems[i]
    if (item.kind !== 'file') continue

    // 1) Attempt File System Access BFS
    if (item.getAsFileSystemHandle) {
      try {
        const handle = await item.getAsFileSystemHandle()
        const fsFiles = await bfsTraverseFsHandle(handle)
        allFiles.push(...fsFiles)
        continue
      } catch (err) {
        console.warn('FS Access BFS error, fallback to webkit:', err)
        // fall through to webkit below
      }
    }

    // 2) Attempt webkitGetAsEntry BFS
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry()
      if (entry) {
        const entries = await bfsTraverseWebkitEntry(entry)
        const realFiles = await Promise.all(entries.map(e => fileEntryToFile(e)))
        allFiles.push(...realFiles)
        continue
      }
    }

    // 3) Fallback single file read
    const file = item.getAsFile()
    if (file) {
      file.fullPath = file.name
      allFiles.push(file)
    }
  }

  return allFiles
}

/**
 * Hook: accept multiple directories + multiple files in a single drop.
 * For each discovered file, calls onText(fileText, fileObject).
 */
export function useFileDrop(onText) {
  // Must prevent default on dragOver to enable drop
  const dragOver = useCallback(e => {
    e.preventDefault()
  }, [])

  // On drop, gather all files, BFS read them if needed
  const drop = useCallback(async e => {
    e.preventDefault()
    const dtItems = e.dataTransfer.items
    if (!dtItems) return

    // BFS across everything they dropped
    const files = await gatherAllDroppedFiles(dtItems)
    // Then read each file’s text and call onText
    for (const f of files) {
      await new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => {
          onText(reader.result, f)
          resolve()
        }
        reader.readAsText(f)
      })
    }
  }, [onText])

  return { dragOver, drop }
}

/*──────────────────────────────────────────────────────────────────────────────
  The other hooks: useMode, useTokenCount, useUndoableDelete
──────────────────────────────────────────────────────────────────────────────*/

export function useMode() {
  const ALLOWED = ['DEVELOP','COMMIT','DIAGNOSE']
  const stored  = localStorage.getItem('konzuko-mode')
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP'
  const [mode, _setMode] = useState(initial)

  const setMode = val => {
    if (!ALLOWED.includes(val)) {
      console.warn('Ignoring illegal mode:', val)
      return
    }
    _setMode(val)
  }

  useEffect(() => {
    localStorage.setItem('konzuko-mode', mode)
  }, [mode])

  return [mode, setMode]
}

export function useTokenCount(messages = [], model = 'gpt-3.5-turbo') {
  const [count, setCount] = useState(0)
  const encRef            = useRef({})
  const getEncoder        = useCallback(async () => {
    if (!encRef.current[model]) {
      encRef.current[model] = await encodingForModel(model)
    }
    return encRef.current[model]
  }, [model])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!messages.length) {
        if (!cancelled) setCount(0)
        return
      }
      try {
        const enc = await getEncoder()
        const total = messages.reduce((sum, m) => {
          const txt = Array.isArray(m.content)
            ? m.content.map(c => c.type==='text' ? c.text : '').join('')
            : String(m.content)
          return sum + enc.encode(txt).length
        }, 0)
        if (!cancelled) setCount(total)
      }
      catch {
        if (!cancelled) setCount(0)
      }
    })()
    return () => { cancelled = true }
  }, [messages, getEncoder])

  return count
}

export function useUndoableDelete(showToast) {
  return useCallback(async ({
    itemLabel,
    confirmMessage,
    deleteFn,
    undoFn,
    afterDelete
  }) => {
    if (!confirm(confirmMessage ||
      `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`))
    {
      return
    }
    try {
      await deleteFn()
      afterDelete?.()
      showToast(`${itemLabel} deleted.`, () => undoFn())
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }, [showToast])
}