// src/hooks.js
import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'preact/hooks'
import { encodingForModel } from 'js-tiktoken'
import { LOCALSTORAGE_DEBOUNCE } from './config.js'

/*─────────────────────  localStorage w/ debounce ──────────────────────*/
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

/*──────────────────────────  settings ─────────────────────────────────*/
export function useSettings() {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey: '',
    model: 'gpt-3.5-turbo',
    codeType: 'javascript',
    showSettings: false,
  })
}

/*──────────────────────────  form-data ─────────────────────────────────*/
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

/*──────────────────────────  file‐drop ─────────────────────────────────*/
export function useFileDrop(onText /* (text, file) => void */) {
  const dragOver = useCallback((e) => {
    e.preventDefault()
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

/*─────────────────────────────  mode ───────────────────────────────────*/
export function useMode() {
  const ALLOWED = ['DEVELOP', 'COMMIT', 'DIAGNOSE']
  const stored  = localStorage.getItem('konzuko-mode')
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP'
  const [mode, _setMode] = useState(initial)
  const setMode = (val) => {
    if (!ALLOWED.includes(val)) {
      console.warn('⚠️ Ignored illegal mode:', val)
      return
    }
    _setMode(val)
  }
  useEffect(() => {
    localStorage.setItem('konzuko-mode', mode)
  }, [mode])
  return [mode, setMode]
}

/*───────────────────────────  token count ─────────────────────────────*/
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
            ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
            : String(m.content)
          return sum + enc.encode(txt).length
        }, 0)
        if (!cancelled) setCount(total)
      } catch {
        if (!cancelled) setCount(0)
      }
    })()
    return () => { cancelled = true }
  }, [messages, getEncoder])

  return count
}

/*──────────────────────────── undoable delete ──────────────────────────*/
export function useUndoableDelete(showToast) {
  return useCallback(
    async ({
      itemLabel,
      confirmMessage = `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`,
      deleteFn,
      undoFn,
      afterDelete,
    }) => {
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