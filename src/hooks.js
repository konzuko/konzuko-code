// src/hooks.js
import { useState, useEffect } from 'preact/hooks'

// 1) Persisted settings
const KEY_SETTINGS = 'konzuko-settings'
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(KEY_SETTINGS)) }
  catch { }
  return { apiKey:'', model:'gpt-4o', codeType:'javascript', showSettings:false }
}
export function useSettings() {
  const [settings, setSettings] = useState(loadSettings())
  useEffect(() => {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings))
  }, [settings])
  return [settings, setSettings]
}

// 2) Persisted form data
const KEY_FORM = 'konzuko-form-data'
function loadForm() {
  try { return JSON.parse(localStorage.getItem(KEY_FORM)) }
  catch { }
  return {
    developGoal:'',
    developFeatures:'',
    developReturnFormat:
      'return complete refactored code in FULL so that i can paste it directly into my ide',
    developWarnings:'',
    developContext:'',
    fixCode:'',
    fixErrors:''
  }
}
export function useFormData() {
  const [form, setForm] = useState(loadForm())
  useEffect(() => {
    localStorage.setItem(KEY_FORM, JSON.stringify(form))
  }, [form])
  return [form, setForm]
}

// 3) Misc per‐chat state hooks
export function useDroppedFiles() { return useState({}) }

const KEY_MODE = 'konzuko-mode'
function loadMode() { return localStorage.getItem(KEY_MODE) || 'DEVELOP' }
export function useMode() {
  const [mode, setMode] = useState(loadMode())
  useEffect(() => localStorage.setItem(KEY_MODE, mode), [mode])
  return [mode, setMode]
}

// 4) Exact token counter via tiktoken + WASM
//    We import the wasm initializer and pump it through top-level await:
import wasmInit from '@dqbd/tiktoken/wasm?init'
import { encoding_for_model } from '@dqbd/tiktoken'

let encoder = null
async function ensureEncoder() {
  if (!encoder) {
    // initialize the wasm module
    await wasmInit()
    // choose your model’s encoding (gpt-3.5-turbo uses cl100k_base under the hood)
    encoder = encoding_for_model('gpt-3.5-turbo')
  }
  return encoder
}
// kick off download immediately (no blocking)
ensureEncoder().catch(console.error)

// fallback heuristic until encoder is ready
function approxCount(str = '') {
  return Math.ceil(str.length / 4)
}

export function useTokenCounter() {
  return (messages = []) => {
    // if encoder not yet ready, use heuristic
    if (!encoder) {
      return messages.reduce((sum, m) => {
        const txt = Array.isArray(m.content)
          ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
          : String(m.content)
        return sum + approxCount(txt)
      }, 0)
    }
    // exact count
    return messages.reduce((sum, m) => {
      const txt = Array.isArray(m.content)
        ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
        : String(m.content)
      return sum + encoder.encode(txt).length
    }, 0)
  }
}