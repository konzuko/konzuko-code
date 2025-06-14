/* src/hooks/useChatSessionManager.js */
// src/hooks/useChatSessionManager.js
import { useState, useCallback } from 'preact/hooks';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  createChat,
  updateChatTitle as apiUpdateChatTitle,
  deleteChat as apiDeleteChat,
  undoDeleteChat,
  GEMINI_MODEL_NAME,
} from '../api.js';
import { LOCALSTORAGE_LAST_CHAT_ID_KEY } from '../config.js';
import Toast from '../components/Toast.jsx';

export function useChatSessionManager() {
  const queryClient = useQueryClient();

  const [currentChatId, _setCurrentChatId] = useState(() => {
    try {
      return localStorage.getItem(LOCALSTORAGE_LAST_CHAT_ID_KEY) || null;
    } catch (e) {
      console.warn("Failed to read last chat ID from localStorage", e);
      return null;
    }
  });

  const setCurrentChatId = useCallback((chatId) => {
    _setCurrentChatId(chatId);
    if (chatId) {
      try {
        localStorage.setItem(LOCALSTORAGE_LAST_CHAT_ID_KEY, String(chatId));
      } catch (e) {
        console.warn("Failed to save last chat ID to localStorage", e);
      }
    } else {
      try {
        localStorage.removeItem(LOCALSTORAGE_LAST_CHAT_ID_KEY);
      } catch (e) {
        console.warn("Failed to remove last chat ID from localStorage", e);
      }
    }
  }, [_setCurrentChatId]);

  const createChatMutation = useMutation({
    mutationKey: ['createChat'],
    mutationFn: (newChatData) => createChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (newlyCreatedChat && newlyCreatedChat.id) {
        setCurrentChatId(newlyCreatedChat.id);
      }
      Toast('New task created!', 2000);
    },
    onError: (error) => {
      Toast('Failed to create task: ' + error.message, 5000);
    },
  });

  const undoDeleteChatMutation = useMutation({
    mutationFn: (chatId) => undoDeleteChat(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      Toast('Task restored.', 2000);
    },
    onError: (error) => {
      Toast('Failed to restore task: ' + error.message, 5000);
    },
  });

  const internalDeleteChatMutation = useMutation({
    mutationFn: (chatId) => apiDeleteChat(chatId),
    onMutate: async (chatId) => {
      await queryClient.cancelQueries({ queryKey: ['chats'] });
      const previousChatsData = queryClient.getQueryData(['chats']);
      queryClient.setQueryData(['chats'], (oldInfiniteData) => {
        if (!oldInfiniteData) return oldInfiniteData;
        const newPages = oldInfiniteData.pages.map(page => ({
          ...page,
          chats: page.chats.filter(chat => chat.id !== chatId),
        }));
        return { ...oldInfiniteData, pages: newPages };
      });
      return { previousChatsData, chatId };
    },
    onSuccess: (data, chatId) => {
      if (currentChatId === chatId) {
        setCurrentChatId(null);
      }
      Toast('Task deleted.', 15000, () => {
        undoDeleteChatMutation.mutate(chatId);
      });
    },
    onSettled: () => {
      const chatsData = queryClient.getQueryData(['chats']);
      const totalChats = chatsData?.pages?.reduce((acc, page) => acc + (page.chats?.length || 0), 0) ?? 0;
      
      if (totalChats === 0 && !createChatMutation.isPending) {
        createChatMutation.mutate({ title: 'First Task', model: GEMINI_MODEL_NAME });
      }

      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (err, chatId, context) => {
      if (context?.previousChatsData) {
        queryClient.setQueryData(['chats'], context.previousChatsData);
      }
      Toast('Failed to delete task: ' + err.message, 5000);
    },
  });

  const updateChatTitleMutation = useMutation({
    mutationFn: ({ id, title }) => apiUpdateChatTitle(id, title),
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: ['chats'] });
      const previousChatsData = queryClient.getQueryData(['chats']);
      queryClient.setQueryData(['chats'], (oldInfiniteData) => {
        if (!oldInfiniteData) return oldInfiniteData;
        return {
          ...oldInfiniteData,
          pages: oldInfiniteData.pages.map(page => ({
            ...page,
            chats: page.chats.map(chat =>
              chat.id === id ? { ...chat, title: title, updated_at: new Date().toISOString() } : chat
            ),
          })),
        };
      });
      return { previousChatsData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (err, variables, context) => {
      if (context?.previousChatsData) {
        queryClient.setQueryData(['chats'], context.previousChatsData);
      }
      Toast('Failed to update title: ' + err.message, 5000);
    },
  });

  const handleCreateChat = useCallback((data = {}) => {
    if (createChatMutation.isPending) return;
    createChatMutation.mutate({ title: data.title || 'New Task', model: data.model || GEMINI_MODEL_NAME });
  }, [createChatMutation]);

  const handleDeleteChat = useCallback((chatId) => {
    if (internalDeleteChatMutation.isPending || undoDeleteChatMutation.isPending) return;
    if (window.confirm('Are you sure you want to delete this task? This action can be undone from the notification.')) {
      internalDeleteChatMutation.mutate(chatId);
    }
  }, [internalDeleteChatMutation, undoDeleteChatMutation]);

  const isSessionBusy = createChatMutation.isPending ||
                        internalDeleteChatMutation.isPending ||
                        undoDeleteChatMutation.isPending;

  return {
    currentChatId,
    setCurrentChatId,
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat,
    updateChatTitle: updateChatTitleMutation.mutateAsync,
    undoDeleteChat: undoDeleteChatMutation.mutate,
    isSessionBusy,
    isCreatingChat: createChatMutation.isPending,
    isDeletingChat: internalDeleteChatMutation.isPending,
    isUpdatingTitle: updateChatTitleMutation.isPending,
  };
}
