/* -------------------------------------------------------------------------
   src/hooks.js
   Generic hooks – +NEW useUndoableDelete helper
---------------------------------------------------------------------------*/
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { encodingForModel }                         from 'js-tiktoken'
import { LOCALSTORAGE_DEBOUNCE }                    from './config.js'

/*────────────────────────────
  Generic debounced
  localStorage helper
─────────────────────────────*/
function useDebouncedLocalStorage (key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial }
    catch { return initial }
  })

  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(value)) }
      catch (err) { console.warn('localStorage error', err) }
    }, delay)
    return () => clearTimeout(id)
  }, [key, value, delay])

  return [value, setValue]
}

/*────────────────── Settings */
export function useSettings () {
  return useDebouncedLocalStorage('konzuko-settings', {
    apiKey       : '',
    model        : 'gpt-3.5-turbo',
    codeType     : 'javascript',
    showSettings : false
  })
}

/*────────────────── Form data */
export function useFormData () {
  return useDebouncedLocalStorage('konzuko-form-data', {
    developGoal        : '',
    developFeatures    : '',
    developReturnFormat: 'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings    : '',
    developContext     : '',
    fixCode            : '',
    fixErrors          : ''
  })
}

/*────────── Misc small hooks */
export function useDroppedFiles () { return useState({}) }

export function useMode () {
  const [mode, setMode] = useState(() => localStorage.getItem('konzuko-mode') ?? 'DEVELOP')
  useEffect(() => { localStorage.setItem('konzuko-mode', mode) }, [mode])
  return [mode, setMode]
}

/*────────────────────────────
  Exact token counter – safe,
  memoised & cancellation-aware
─────────────────────────────*/
export function useTokenCount (messages = [], model = 'gpt-3.5-turbo') {
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
      if (!messages.length) { setCount(0); return }

      try {
        const enc = await getEncoder()
        const total = messages.reduce((sum, m) => {
          const txt = Array.isArray(m.content)
            ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
            : String(m.content)
          return sum + enc.encode(txt).length
        }, 0)
        if (!cancelled) setCount(total)
      } catch (err) {
        if (!cancelled) setCount(0)
        console.warn('Token count failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [messages, getEncoder])

  return count
}

/*────────────────────────────
  NEW: One-liner to DRY undoable
  delete flows for chats/messages
─────────────────────────────*/
export function useUndoableDelete (showToast) {
  return useCallback(async ({
    itemLabel       = 'Item',          // “Chat” | “Message” | etc.
    confirmMessage  = `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`,
    deleteFn,                          // () → Promise
    undoFn,                            // () → Promise
    afterDelete                     ,  // () → void (optional)
  }) => {
    if (!deleteFn || !undoFn) {
      throw new Error('useUndoableDelete requires deleteFn and undoFn')
    }

    if (!confirm(confirmMessage)) return
    try {
      await deleteFn()
      afterDelete?.()
      showToast(
        `${itemLabel} deleted.`,
        () => undoFn()                 // Toast catches & reports errors
      )
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }, [showToast])
}