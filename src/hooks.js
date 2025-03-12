/* hooks.js */
import { useState, useEffect } from 'preact/hooks';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';
const LOCAL_STORAGE_FORM_DATA_KEY = 'konzuko-form-data';
const LOCAL_STORAGE_DROPPED_FILES_KEY = 'konzuko-dropped-files';
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
    saveSettings(settings);
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
    saveFormData(formData);
  }, [formData]);
  return [formData, setFormData];
}

function loadDroppedFiles() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DROPPED_FILES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return {};
}

function saveDroppedFiles(droppedFiles) {
  localStorage.setItem(LOCAL_STORAGE_DROPPED_FILES_KEY, JSON.stringify(droppedFiles));
}

export function useDroppedFiles() {
  const [droppedFiles, setDroppedFiles] = useState(loadDroppedFiles());
  useEffect(() => {
    saveDroppedFiles(droppedFiles);
  }, [droppedFiles]);
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
    saveMode(mode);
  }, [mode]);
  return [mode, setMode];
}

export function useChats() {
  const [chats, setChats] = useState(loadChats());
  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  function addChat(chat) {
    setChats([...chats, chat]);
  }

  function updateChat(updatedChat) {
    const index = chats.findIndex(c => c.id === updatedChat.id);
    if (index === -1) return;
    const newChats = [...chats];
    newChats[index] = { ...updatedChat };
    setChats(newChats);
  }

  function deleteChat(chatId) {
    const newChats = chats.filter(c => c.id !== chatId);
    setChats(newChats);
  }

  return {
    chats,
    addChat,
    updateChat,
    deleteChat
  };
}
