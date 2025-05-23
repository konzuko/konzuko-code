// src/hooks/useChatSessionManager.js
import { useState, useCallback } from 'preact/hooks';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  createChat,
  updateChatTitle,
  deleteChat as apiDeleteChat,
  undoDeleteChat,
  GEMINI_MODEL_NAME,
  // fetchChats // No longer needed here for initial check
} from '../api.js';
import Toast from '../components/Toast.jsx';

const LAST_CHAT_ID_KEY = 'konzuko-lastChatId';

export function useChatSessionManager() {
  const queryClient = useQueryClient();

  const [currentChatId, _setCurrentChatId] = useState(() => {
    try {
      return localStorage.getItem(LAST_CHAT_ID_KEY) || null;
    } catch (e) {
      console.warn("Failed to read last chat ID from localStorage", e);
      return null;
    }
  });

  const setCurrentChatId = useCallback((chatId) => {
    _setCurrentChatId(chatId);
    if (chatId) {
      try {
        localStorage.setItem(LAST_CHAT_ID_KEY, String(chatId)); // Ensure it's a string
      } catch (e) {
        console.warn("Failed to save last chat ID to localStorage", e);
      }
    } else {
      try {
        localStorage.removeItem(LAST_CHAT_ID_KEY);
      } catch (e) {
        console.warn("Failed to remove last chat ID from localStorage", e);
      }
    }
  }, [_setCurrentChatId]);


  // Removed the useQuery for 'chatsInitialCheck' and its associated useEffect
  // as ChatList.jsx will now handle initial selection and "First Chat" creation
  // based on the primary ['chats'] useInfiniteQuery.

  const createChatMutation = useMutation({
    mutationFn: (newChatData) => createChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      // queryClient.invalidateQueries({ queryKey: ['chatsInitialCheck'] }); // No longer needed
      if (newlyCreatedChat && newlyCreatedChat.id) {
        setCurrentChatId(newlyCreatedChat.id); // This will also save to localStorage
      }
      Toast('New chat created!', 2000);
    },
    onError: (error) => {
      Toast('Failed to create chat: ' + error.message, 5000);
    },
  });

  const undoDeleteChatMutation = useMutation({
    mutationFn: (chatId) => undoDeleteChat(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      Toast('Chat restored.', 2000);
    },
    onError: (error) => {
      Toast('Failed to restore chat: ' + error.message, 5000);
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
        setCurrentChatId(null); // Clear currentChatId if it was deleted, also removes from localStorage
      }
      // queryClient.invalidateQueries({ queryKey: ['chatsInitialCheck'] }); // No longer needed
      Toast('Chat deleted.', 15000, () => {
        undoDeleteChatMutation.mutate(chatId);
      });
    },
    onError: (err, chatId, context) => {
      if (context?.previousChatsData) {
        queryClient.setQueryData(['chats'], context.previousChatsData);
      }
      Toast('Failed to delete chat: ' + err.message, 5000);
    },
  });

  const updateChatTitleMutation = useMutation({
    mutationFn: ({ id, title }) => updateChatTitle(id, title),
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
      Toast('Title updated!', 2000);
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
    createChatMutation.mutate({ title: data.title || 'New Chat', model: data.model || GEMINI_MODEL_NAME });
  }, [createChatMutation]);

  const handleDeleteChat = useCallback((chatId) => {
    if (internalDeleteChatMutation.isPending || undoDeleteChatMutation.isPending) return;
    if (window.confirm('Are you sure you want to delete this chat? This action can be undone from the notification.')) {
      internalDeleteChatMutation.mutate(chatId);
    }
  }, [internalDeleteChatMutation, undoDeleteChatMutation]);

  // Removed useEffect related to initialChatsSuccess and initialChatsData for "First Chat" creation

  const isLoadingSession = createChatMutation.isPending ||
                           internalDeleteChatMutation.isPending ||
                           updateChatTitleMutation.isPending ||
                           undoDeleteChatMutation.isPending;

  return {
    currentChatId,
    setCurrentChatId, // This is now the wrapped version that saves to localStorage
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat,
    updateChatTitle: updateChatTitleMutation.mutate,
    undoDeleteChat: undoDeleteChatMutation.mutate,
    isLoadingSession,
    isCreatingChat: createChatMutation.isPending,
  };
}
