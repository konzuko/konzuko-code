/* hooks.js */
import { useState, useEffect } from 'preact/hooks';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';

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
  return { apiKey: '', openRouterApiKey: '', model: 'mistralai/mistral-small-24b-instruct-2501' };
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
