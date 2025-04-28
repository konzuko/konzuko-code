/* -------------------------------------------------------------------------
   src/hooks.js
   Generic hooks + useUndoableDelete + useFileDrop
---------------------------------------------------------------------------*/
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'preact/hooks'
import { encodingForModel } from 'js-tiktoken'
import { LOCALSTORAGE_DEBOUNCE } from './config.js'

/*────────────────────────────  Local-storage helpers  ────────────────────*/
function useDebouncedLocalStorage(
  key,
  initial,
  delay = LOCALSTORAGE_DEBOUNCE,
) {
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
      } catch (err) {
        console.warn('localStorage error', err)
      }
    }, delay)
    return () => clearTimeout(id)
  }, [key, value, delay])

  return [value, setValue]
}

/*────────────────────────────  App-level settings  ───────────────────────*/
export function useSettings() {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey: '',
    model: 'gpt-3.5-turbo',
    codeType: 'javascript',
    showSettings: false,
  })
}

export function useFormData() {
  return useDebouncedLocalStorage('konzuko-form-data', {
    developGoal: '',
    developFeatures: '',
    developReturnFormat:
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings: '',
    developContext: '',
    fixCode: '',
    fixErrors: '',
  })
}

/*────────────────────────────  Drag-and-drop files  ──────────────────────*/
export function useFileDrop(onText /* (text, file) => void */) {
  const dragOver = useCallback((e) => {
    e.preventDefault() // allow drop
  }, [])

  const drop = useCallback(
    (e) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => onText(reader.result, file)
      reader.readAsText(file)
    },
    [onText],
  )

  return { dragOver, drop }
}

/*────────────────────────────  Misc. UI state  ───────────────────────────*/
/* Hardened version: UNDER NO CIRCUMSTANCES can mode be invalid */
export function useMode() {
  const ALLOWED = ['DEVELOP', 'COMMIT', 'DIAGNOSE']

  // 1) safe initial value
  const stored  = localStorage.getItem('konzuko-mode')
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP'

  const [mode, _setMode] = useState(initial)

  // 2) guarded setter
  const setMode = (val) => {
    if (!ALLOWED.includes(val)) {
      console.warn('⚠️  Ignored attempt to set illegal mode:', val)
      return
    }
    _setMode(val)
  }

  // 3) keep localStorage in sync
  useEffect(() => {
    localStorage.setItem('konzuko-mode', mode)
  }, [mode])

  return [mode, setMode]
}

export function useTokenCount(messages = [], model = 'gpt-3.5-turbo') {
  const [count, setCount] = useState(0)
  const encRef = useRef({})

  const getEncoder = useCallback(async () => {
    if (!encRef.current[model]) {
      encRef.current[model] = await encodingForModel(model)
    }
    return encRef.current[model]
  }, [model])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!messages.length) {
        setCount(0)
        return
      }
      try {
        const enc = await getEncoder()
        const total = messages.reduce((sum, m) => {
          const txt = Array.isArray(m.content)
            ? m.content
                .map((c) => (c.type === 'text' ? c.text : ''))
                .join('')
            : String(m.content)
          return sum + enc.encode(txt).length
        }, 0)
        if (!cancelled) setCount(total)
      } catch (err) {
        if (!cancelled) setCount(0)
        console.warn('Token count failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [messages, getEncoder])

  return count
}

/*────────────────────────────  Undoable delete  ──────────────────────────*/
export function useUndoableDelete(showToast) {
  return useCallback(
    async ({
      itemLabel = 'Item', // e.g. "Chat" or "Message"
      confirmMessage = `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`,
      deleteFn, // () => Promise
      undoFn, // () => Promise
      afterDelete, // () => void
    }) => {
      if (!deleteFn || !undoFn) {
        throw new Error('useUndoableDelete requires deleteFn and undoFn')
      }
      if (!confirm(confirmMessage)) return
      try {
        await deleteFn()
        afterDelete?.()
        showToast(`${itemLabel} deleted.`, () => undoFn())
      } catch (err) {
        alert(`Delete failed: ${err.message}`)
      }
    },
    [showToast],
  )
}