// src/hooks/useChatSessionManager.js
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import {
  createChat,
  updateChatTitle,
  deleteChat as apiDeleteChat, // Renamed to avoid conflict with the handler function
  undoDeleteChat,
  GEMINI_MODEL_NAME,
  fetchChats
} from '../api.js';
import Toast from '../components/Toast.jsx';

export function useChatSessionManager() {
  const queryClient = useQueryClient();
  const [currentChatId, setCurrentChatId] = useState(null);

  const { data: initialChatsData, isSuccess: initialChatsSuccess } = useQuery({
    queryKey: ['chatsInitialCheck'],
    queryFn: () => fetchChats({ pageParam: 1 }),
    staleTime: Infinity,
    enabled: !currentChatId,
  });

  const createChatMutation = useMutation({
    mutationFn: (newChatData) => createChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatsInitialCheck'] });
      if (newlyCreatedChat && newlyCreatedChat.id) {
        setCurrentChatId(newlyCreatedChat.id);
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

  // This is the actual mutation that calls the API
  const internalDeleteChatMutation = useMutation({
    mutationFn: (chatId) => apiDeleteChat(chatId), // Uses the renamed apiDeleteChat
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
      queryClient.invalidateQueries({ queryKey: ['chatsInitialCheck'] });
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

  // This is the function that will be exposed and called by App.jsx
  const handleDeleteChat = useCallback((chatId) => {
    if (internalDeleteChatMutation.isPending || undoDeleteChatMutation.isPending) return;
    if (window.confirm('Are you sure you want to delete this chat? This action can be undone from the notification.')) {
      internalDeleteChatMutation.mutate(chatId);
    }
  }, [internalDeleteChatMutation, undoDeleteChatMutation]);


  useEffect(() => {
    if (initialChatsSuccess && initialChatsData && Array.isArray(initialChatsData.pages)) {
      const totalChats = initialChatsData.pages.reduce((acc, page) => {
        return acc + (Array.isArray(page.chats) ? page.chats.length : 0);
      }, 0);

      if (totalChats === 0 && !createChatMutation.isPending && !currentChatId) {
        const existingChatCreation = queryClient.getMutationCache().getAll().find(m => m.options.mutationKey?.[0] === 'createChat' && m.state.status === 'pending');
        if(!existingChatCreation) {
            handleCreateChat({ title: 'First Chat', model: GEMINI_MODEL_NAME });
        }
      }
    }
  }, [initialChatsSuccess, initialChatsData, createChatMutation.isPending, currentChatId, handleCreateChat, queryClient]);


  const isLoadingSession = createChatMutation.isPending ||
                           internalDeleteChatMutation.isPending || // Use internal mutation status
                           updateChatTitleMutation.isPending ||
                           undoDeleteChatMutation.isPending;

  return {
    currentChatId,
    setCurrentChatId,
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat, // Expose the new handler
    updateChatTitle: updateChatTitleMutation.mutate,
    undoDeleteChat: undoDeleteChatMutation.mutate,
    isLoadingSession,
    isCreatingChat: createChatMutation.isPending,
  };
}
