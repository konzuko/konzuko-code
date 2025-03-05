import { useState, useEffect } from 'preact/hooks';
import { summarizeConversation } from './api.js';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';
const MAX_TOKENS = 50000;

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
  return { apiKey: '', model: 'o3-mini-2025-01-31' };
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
  const [totalTokens, setTotalTokens] = useState(0);

  useEffect(() => {
    let sum = 0;
    for (const chat of chats) {
      for (const msg of chat.messages) {
        if (typeof msg.content === 'string') {
          sum += approximateTokenCount(msg.content);
        }
      }
    }
    setTotalTokens(sum);
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

  async function handleMemoryManagement(chatId, apiKey) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return null;
    try {
      // Use the summarizeConversation function from api.js
      const summary = await summarizeConversation(chat.messages, apiKey, chat.model);
      const newChat = {
        id: Date.now() + '-' + Math.random().toString(36).substring(2, 9),
        title: `${chat.title} (Continued)`,
        started: new Date().toISOString(),
        messages: [
          {
            id: 'system-summary',
            role: 'system',
            content: `Continuation summary:\n\n${summary}`,
            timestamp: Date.now()
          }
        ],
        model: chat.model,
      };
      addChat(newChat);
      const memoryLimitMessage = {
        id: 'system-memory-limit',
        role: 'system',
        content: 'Memory limit reached. A new chat has been created with a summary of this conversation. Check the sidebar.',
        timestamp: Date.now()
      };
      updateChat({
        ...chat,
        messages: [...chat.messages, memoryLimitMessage]
      });
      return newChat.id;
    } catch (error) {
      console.error('Error during memory management:', error);
      return null;
    }
  }

  return {
    chats,
    addChat,
    updateChat,
    totalTokens,
    handleMemoryManagement,
    isMemoryLimitExceeded: totalTokens > MAX_TOKENS
  };
}
