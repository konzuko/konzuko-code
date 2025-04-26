import { useState, useEffect } from 'preact/hooks'
import { encodingForModel } from 'js-tiktoken'  // changed from encoding_for_model

/* ─── localStorage keys ───────────────────────────────── */
const KEY_SETTINGS = 'konzuko-settings'
const KEY_FORM     = 'konzuko-form-data'
const KEY_MODE     = 'konzuko-mode'

/* ─── SETTINGS HOOK ───────────────────────────────────── */
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(KEY_SETTINGS)) }
  catch { }
  return {
    apiKey: '',
    model: 'gpt-3.5-turbo',
    codeType: 'javascript',
    showSettings: false
  }
}
export function useSettings() {
  const [settings, setSettings] = useState(loadSettings())
  useEffect(() => {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings))
  }, [settings])
  return [settings, setSettings]
}

/* ─── FORM DATA HOOK ──────────────────────────────────── */
function loadForm() {
  try { return JSON.parse(localStorage.getItem(KEY_FORM)) }
  catch { }
  return {
    developGoal: '',
    developFeatures: '',
    developReturnFormat:
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings: '',
    developContext: '',
    fixCode: '',
    fixErrors: ''
  }
}
export function useFormData() {
  const [formData, setFormData] = useState(loadForm())
  useEffect(() => {
    localStorage.setItem(KEY_FORM, JSON.stringify(formData))
  }, [formData])
  return [formData, setFormData]
}

/* ─── MISC HOOKS ─────────────────────────────────────── */
export function useDroppedFiles() {
  return useState({})
}

function loadMode() {
  return localStorage.getItem(KEY_MODE) || 'DEVELOP'
}
export function useMode() {
  const [mode, setMode] = useState(loadMode())
  useEffect(() => {
    localStorage.setItem(KEY_MODE, mode)
  }, [mode])
  return [mode, setMode]
}

/* ─── EXACT TOKEN COUNTER (async now) ────────────────── */
let _encoderPromise = null

async function getEncoder(model = 'gpt-3.5-turbo') {
  if (!_encoderPromise) {
    // create a single shared encoder instance (async)
    _encoderPromise = encodingForModel(model)
  }
  return _encoderPromise
}

export function useTokenCounter() {
  // Return a function that takes messages and returns a Promise<number>
  return async (messages = []) => {
    if (!messages.length) return 0
    const encoder = await getEncoder()

    // Sum token counts
    const total = messages.reduce((sum, msg) => {
      const txt = Array.isArray(msg.content)
        ? msg.content.map(c => (c.type === 'text' ? c.text : '')).join('')
        : String(msg.content)
      return sum + encoder.encode(txt).length
    }, 0)

    // We do NOT call encoder.free() each time because we want to reuse it
    return total
  }
}

/* ─── so i can save a commit ───────────────────────────────────── */
