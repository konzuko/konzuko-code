import { useState, useEffect } from 'preact/hooks';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';
const LOCAL_STORAGE_FORM_DATA_KEY = 'konzuko-form-data';
// Removed LOCAL_STORAGE_DROPPED_FILES_KEY to fix per‐chat dropped files
const LOCAL_STORAGE_MODE_KEY = 'konzuko-mode';

export function approximateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function loadChats() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return [];
}

function saveChats(chats) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(chats));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return { apiKey: '', openRouterApiKey: '', model: 'qwen/qwen2.5-vl-72b-instruct' };
}

function saveSettings(settings) {
  localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings());
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveSettings(settings);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [settings]);
  return [settings, setSettings];
}

function loadFormData() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FORM_DATA_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return {
    developGoal: '',
    developFeatures: '',
    developReturnFormat: '',
    developWarnings: '',
    developContext: '',
    fixCode: '',
    fixErrors: '',
  };
}

function saveFormData(formData) {
  localStorage.setItem(LOCAL_STORAGE_FORM_DATA_KEY, JSON.stringify(formData));
}

export function useFormData() {
  const [formData, setFormData] = useState(loadFormData());
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveFormData(formData);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [formData]);
  return [formData, setFormData];
}

// Changed useDroppedFiles to keep state in memory only (per-chat) rather than persist globally.
export function useDroppedFiles() {
  const [droppedFiles, setDroppedFiles] = useState({});
  return [droppedFiles, setDroppedFiles];
}

function loadMode() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_MODE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return 'DEVELOP';
}

function saveMode(mode) {
  localStorage.setItem(LOCAL_STORAGE_MODE_KEY, JSON.stringify(mode));
}

export function useMode() {
  const [mode, setMode] = useState(loadMode());
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveMode(mode);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [mode]);
  return [mode, setMode];
}

export function useChats() {
  const [chats, setChats] = useState(loadChats());
  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      saveChats(chats);
    }, 500);
    return () => clearTimeout(debounceTimeout);
  }, [chats]);

  function addChat(chat) {
    setChats(prevChats => [...prevChats, chat]);
  }

  function updateChat(updatedChat) {
    setChats(prevChats => prevChats.map(c => c.id === updatedChat.id ? updatedChat : c));
  }

  function deleteChat(chatId) {
    setChats(prevChats => prevChats.filter(c => c.id !== chatId));
  }

  return {
    chats,
    addChat,
    updateChat,
    deleteChat
  };
}
