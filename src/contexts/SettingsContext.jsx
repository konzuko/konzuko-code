// file: src/contexts/SettingsContext.jsx
import { createContext, useContext } from 'preact/compat';
import { useState, useCallback, useEffect } from 'preact/hooks';
import { LOCALSTORAGE_PANE_WIDTH_KEY, LOCALSTORAGE_SETTINGS_KEY } from '../config.js';
import { GEMINI_MODEL_NAME } from '../api.js';

const getInitialPaneWidth = () => {
  try {
    const storedWidth = localStorage.getItem(LOCALSTORAGE_PANE_WIDTH_KEY);
    if (storedWidth) {
      const percent = parseFloat(storedWidth);
      if (percent >= 20 && percent <= 80) {
        return `${percent}%`;
      }
    }
  } catch (e) {
    console.warn("Could not read pane width from localStorage", e);
  }
  return window.innerWidth <= 1600 ? '60%' : '50%';
};

const getInitialDisplaySettings = () => {
    try {
        const stored = localStorage.getItem(LOCALSTORAGE_SETTINGS_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                model: GEMINI_MODEL_NAME, // Always enforce the correct model
                showSettings: !!parsed.showSettings,
            };
        }
    } catch (e) {
        console.warn("Could not read display settings from localStorage", e);
    }
    return {
        model: GEMINI_MODEL_NAME,
        showSettings: false,
    };
};


const SettingsContext = createContext();
SettingsContext.displayName = 'SettingsContext';

export const SettingsProvider = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [leftPaneWidth, setLeftPaneWidth] = useState(getInitialPaneWidth);
  const [displaySettings, setDisplaySettings] = useState(getInitialDisplaySettings);

  const handleToggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  useEffect(() => {
    try {
        const settingsToSave = {
            showSettings: displaySettings.showSettings,
            // model is not saved as it's constant
        };
        localStorage.setItem(LOCALSTORAGE_SETTINGS_KEY, JSON.stringify(settingsToSave));
    } catch (e) {
        console.warn("Could not save display settings to localStorage", e);
    }
  }, [displaySettings]);

  const value = {
    collapsed,
    handleToggleCollapse,
    leftPaneWidth,
    setLeftPaneWidth,
    displaySettings,
    setDisplaySettings,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
