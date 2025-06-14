// file: src/contexts/SettingsContext.jsx
import { createContext, useContext } from 'preact/compat';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { supabase } from '../lib/supabase.js';
import Toast from '../components/Toast.jsx';

import {
  LOCALSTORAGE_PANE_WIDTH_KEY,
  LOCALSTORAGE_SETTINGS_KEY,
  LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY,
} from '../config.js';

import { GEMINI_MODEL_NAME } from '../api.js';               // ← fixed path

/* ───────────────────────── helpers ───────────────────────── */
const getInitialPaneWidth = () => {
  try {
    const storedWidth = localStorage.getItem(LOCALSTORAGE_PANE_WIDTH_KEY);
    if (storedWidth) {
      const percent = parseFloat(storedWidth);
      if (percent >= 20 && percent <= 80) return `${percent}%`;
    }
  } catch (e) {
    console.warn('Could not read pane width from localStorage', e);
  }
  return window.innerWidth <= 1600 ? '60%' : '50%';
};

const getInitialDisplaySettings = () => {
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        model: GEMINI_MODEL_NAME,
        showSettings: !!parsed.showSettings,
      };
    }
  } catch (e) {
    console.warn('Could not read display settings from localStorage', e);
  }
  return { model: GEMINI_MODEL_NAME, showSettings: false };
};

const getInitialCollapsedState = () => {
  try {
    return localStorage.getItem(LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch (e) {
    console.warn('Could not read sidebar collapsed state', e);
    return false;
  }
};

/* ───────────────────────── context ───────────────────────── */
const SettingsContext = createContext();
SettingsContext.displayName = 'SettingsContext';

export const SettingsProvider = ({ children }) => {
  /* layout state */
  const [collapsed, setCollapsed] = useState(getInitialCollapsedState);
  const [leftPaneWidth, setLeftPaneWidth] = useState(getInitialPaneWidth);

  /* misc display settings */
  const [displaySettings, setDisplaySettings] = useState(getInitialDisplaySettings);

  /* Gemini API-key management */
  const [apiKey, setApiKey] = useState('');
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true);

  const handleToggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  /* ───── persist small prefs ───── */
  useEffect(() => {
    try {
      const toSave = { showSettings: displaySettings.showSettings };
      localStorage.setItem(LOCALSTORAGE_SETTINGS_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('Could not save display settings', e);
    }
  }, [displaySettings]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCALSTORAGE_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch (e) {
      console.warn('Could not save sidebar collapsed state', e);
    }
  }, [collapsed]);

  /* ───── fetch API key once after auth ───── */
  useEffect(() => {
    (async () => {
      setIsApiKeyLoading(true);
      try {
        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error || !sessionData.session) return setIsApiKeyLoading(false);

        const { data, error: edgeErr } = await supabase.functions.invoke('manage-api-key', { method: 'GET' });
        if (edgeErr) throw edgeErr;
        if (data?.apiKey) setApiKey(data.apiKey);
      } catch (e) {
        console.error('Failed to fetch API key', e);
        Toast(`Error fetching API key: ${e.message}`, 5000);
      } finally {
        setIsApiKeyLoading(false);
      }
    })();
  }, []);

  /* ───── save API key helper ───── */
  const handleApiKeyChangeAndSave = async newKey => {
    const previous = apiKey;
    setApiKey(newKey);
    try {
      const { error, data } = await supabase.functions.invoke('manage-api-key', {
        method: 'POST',
        body: { apiKey: newKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      Toast('API key saved!', 3000);
    } catch (e) {
      console.error('Failed to save API key', e);
      setApiKey(previous);
      Toast(`Error saving API key: ${e.message}`, 5000);
    }
  };

  /* ───── context value ───── */
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
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};
