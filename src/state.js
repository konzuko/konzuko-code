/*
  Stores all app state in localStorage, including:
   - Chat list and each chat's messages
   - Token usage tracking for auto memory management
   - User settings: API key, model
*/

import { useState, useEffect } from 'preact/hooks';
import { summarizeConversation } from './api.js';

const LOCAL_STORAGE_KEY = 'konzuko-chats';
const LOCAL_STORAGE_SETTINGS_KEY = 'konzuko-settings';
const MAX_TOKENS = 50000; // Token limit before memory management kicks in

export function loadChats() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) { /* ignore */ }
  return [];
}

export function saveChats(chats) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(chats));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) { /* ignore */ }
  return { apiKey: '', model: 'o3-mini-high' };
}

export function saveSettings(settings) {
  localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(settings));
}

// More accurate token counting based on OpenAI's guidelines
export function approximateTokenCount(text) {
  if (!text) return 0;
  
  // Basic implementation based on OpenAI's guidelines
  // This is still an approximation but better than simple character count
  // 1 token ~= 4 chars in English
  // 1 token ~= ¾ words
  // 100 tokens ~= 75 words
  
  // Count words (splitting by whitespace)
  const words = text.trim().split(/\s+/).length;
  
  // Apply the 4 chars per token rule as a fallback
  const chars = text.length;
  const charBasedEstimate = Math.ceil(chars / 4);
  
  // Use the word-based estimate (75 words ~= 100 tokens)
  const wordBasedEstimate = Math.ceil(words * (100/75));
  
  // Take the average of both approaches for better accuracy
  return Math.ceil((charBasedEstimate + wordBasedEstimate) / 2);
}

// Count tokens in a full message object (similar to the Python example)
export function countTokensFromMessages(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let numTokens = 0;
  
  for (const message of messages) {
    // Every message follows <im_start>{role/name}\n{content}<im_end>\n format
    numTokens += 4;
    
    // Count tokens in each field
    for (const [key, value] of Object.entries(message)) {
      if (typeof value === 'string') {
        numTokens += approximateTokenCount(value);
      } else if (Array.isArray(value)) {
        // Handle content arrays for new message format
        for (const item of value) {
          if (item.type === 'text' && item.text) {
            numTokens += approximateTokenCount(item.text);
          }
        }
      }
      
      // If there's a name, the role is omitted
      if (key === 'name') {
        numTokens -= 1; // role is always required and always 1 token
      }
    }
  }
  
  // Every reply is primed with <im_start>assistant
  numTokens += 2;
  
  return numTokens;
}

// Custom hook for reading/writing settings from local storage
export function useSettings() {
  const [settings, setSettings] = useState(loadSettings());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  return [settings, setSettings];
}

// Custom hook for reading/writing chats
export function useChats() {
  const [chats, setChats] = useState(loadChats());
  const [totalTokens, setTotalTokens] = useState(0);

  // Recompute token usage whenever chats change
  useEffect(() => {
    let sum = 0;
    for (const c of chats) {
      // Use the more accurate token counting method
      sum += countTokensFromMessages(c.messages);
    }
    setTotalTokens(sum);
    saveChats(chats);
  }, [chats]);

  function addChat(chat) {
    setChats([...chats, chat]);
  }

  function updateChat(updatedChat) {
    const idx = chats.findIndex((c) => c.id === updatedChat.id);
    if (idx === -1) return;
    const newChats = [...chats];
    newChats[idx] = { ...updatedChat };
    setChats(newChats);
  }

  // Handle memory management when token limit is exceeded
  async function handleMemoryManagement(chatId, apiKey) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return null;

    try {
      // Summarize the conversation
      const summary = await summarizeConversation(chat.messages, apiKey, chat.model);

      // Create a new chat with that summary
      const newChat = {
        id: Date.now() + '-' + Math.random().toString(36).substring(2, 9),
        title: `${chat.title} (Continued)`,
        started: new Date().toISOString(),
        messages: [
          {
            id: 'system-summary',
            role: 'system',
            content: `This is a continuation of a previous conversation. Here's a summary of what was discussed:\n\n${summary}`,
            timestamp: Date.now()
          }
        ],
        model: chat.model
      };

      addChat(newChat);

      // Add system note to the old chat
      const memoryLimitMessage = {
        id: 'system-memory-limit',
        role: 'system',
        content: 'Memory limit reached. A new chat has been created with a summary of this conversation. Check the sidebar for the new conversation.',
        timestamp: Date.now()
      };

      updateChat({
        ...chat,
        messages: [...chat.messages, memoryLimitMessage]
      });

      return newChat.id;
    } catch (error) {
      console.error('Error handling memory management:', error);
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
