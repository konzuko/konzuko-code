// src/contexts/SettingsContext.jsx
import { createContext, useContext } from 'preact/compat'
import { useState, useEffect, useCallback } from 'preact/hooks'
import { supabase } from '../lib/supabase.js'
import Toast from '../components/Toast.jsx'

import {
  LOCALSTORAGE_PANE_WIDTH_KEY,
  LOCALSTORAGE_SETTINGS_KEY,
  LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY,
  GEMINI_MODEL_NAME,
} from '../config.js'

/* ------------ helper: call Edge Function without the `apikey` header ---- */
async function invokeManageApiKey(method = 'GET', body = null) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('Not authenticated')

  const res = await fetch('/functions/v1/manage-api-key', {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Edge Function error ${res.status}: ${txt}`)
  }
  return res.json()
}
/* ----------------------------------------------------------------------- */

const SettingsContext = createContext()
SettingsContext.displayName = 'SettingsContext'

/* small helpers to get initial localStorage-backed values */
const getInitialPaneWidth = () => {
  try {
    const maybe = localStorage.getItem(LOCALSTORAGE_PANE_WIDTH_KEY)
    const pct = maybe ? parseFloat(maybe) : NaN
    if (!isNaN(pct) && pct >= 20 && pct <= 80) return `${pct}%`
  } catch {/* ignore */}
  return window.innerWidth <= 1600 ? '60%' : '50%'
}

const getInitialDisplaySettings = () => {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { model: GEMINI_MODEL_NAME, showSettings: !!parsed.showSettings }
    }
  } catch {}
  return { model: GEMINI_MODEL_NAME, showSettings: false }
}

const getInitialCollapsed = () => {
  try {
    return localStorage.getItem(LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY) === 'true'
  } catch { return false }
}

export const SettingsProvider = ({ children }) => {
  /* ----- UI state that MainLayout relies on ---------------------------- */
  const [collapsed, setCollapsed]           = useState(getInitialCollapsed)
  const [leftPaneWidth, setLeftPaneWidth]   = useState(getInitialPaneWidth)
  const [displaySettings, setDisplaySettings] = useState(getInitialDisplaySettings)

  /* ----- API-key state -------------------------------------------------- */
  const [apiKey, setApiKey]           = useState('')
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true)

  /* ----- localStorage persistence for small prefs ---------------------- */
  useEffect(() => {
    try {
      localStorage.setItem(
        LOCALSTORAGE_SETTINGS_KEY,
        JSON.stringify({ showSettings: displaySettings.showSettings })
      )
    } catch {}
  }, [displaySettings])

  useEffect(() => {
    try {
      localStorage.setItem(
        LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY,
        String(collapsed)
      )
    } catch {}
  }, [collapsed])

  /* ----- FETCH stored API key once after login ------------------------- */
  useEffect(() => {
    (async () => {
      setIsApiKeyLoading(true)
      try {
        const { apiKey: stored = '' } = await invokeManageApiKey('GET')
        setApiKey(stored)
      } catch (err) {
        console.error('Fetch API-key failed:', err)
        Toast(`Error fetching API key: ${err.message}`, 5000)
      } finally {
        setIsApiKeyLoading(false)
      }
    })()
  }, [])

  /* ----- save helper ---------------------------------------------------- */
  const handleApiKeyChangeAndSave = useCallback(
    async (newKey) => {
      const prev = apiKey
      setApiKey(newKey)
      try {
        await invokeManageApiKey('POST', { apiKey: newKey.trim() })
        Toast('API key saved!', 3000)
      } catch (err) {
        console.error('Save API-key failed:', err)
        setApiKey(prev)
        Toast(`Error saving API key: ${err.message}`, 5000)
      }
    },
    [apiKey]
  )

  /* ----- toggle collapse helper ---------------------------------------- */
  const handleToggleCollapse = useCallback(
    () => setCollapsed((c) => !c),
    []
  )

  /* ----- context value -------------------------------------------------- */
  const value = {
    collapsed,
    handleToggleCollapse,
    leftPaneWidth,
    setLeftPaneWidth,
    displaySettings,
    setDisplaySettings,

    apiKey,
    isApiKeyLoading,
    handleApiKeyChangeAndSave,

    model: GEMINI_MODEL_NAME,
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
