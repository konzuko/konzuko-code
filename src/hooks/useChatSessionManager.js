// file: src/hooks/useChatSessionManager.js
import { useState, useCallback, useEffect } from 'preact/hooks';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import {
  createChat as apiCreateChat,
  updateChatTitle as apiUpdateChatTitle,
  deleteChat as apiDeleteChat,
  undoDeleteChat,
  GEMINI_MODEL_NAME,
} from '../api.js';
import { LOCALSTORAGE_LAST_CHAT_ID_KEY } from '../config.js';
import Toast from '../components/Toast.jsx';

export function useChatSessionManager() {
  const queryClient = useQueryClient();

  const [currentChatId, setCurrentChatId] = useState(() => {
    try {
      return localStorage.getItem(LOCALSTORAGE_LAST_CHAT_ID_KEY) || null;
    } catch (e) {
      console.warn("Failed to read last chat ID from localStorage", e);
      return null;
    }
  });

  useEffect(() => {
    try {
      if (currentChatId) {
        localStorage.setItem(LOCALSTORAGE_LAST_CHAT_ID_KEY, String(currentChatId));
      } else {
        localStorage.removeItem(LOCALSTORAGE_LAST_CHAT_ID_KEY);
      }
    } catch (e) {
      console.warn("Failed to sync chat ID to localStorage", e);
    }
  }, [currentChatId]);

  const invalidateChats = () => queryClient.invalidateQueries({ queryKey: ['chats'] });

  const createChatMutation = useMutation({
    mutationFn: (newChatData) => apiCreateChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      invalidateChats();
      if (newlyCreatedChat?.id) {
        setCurrentChatId(newlyCreatedChat.id);
      }
      Toast('New task created!', 2000);
    },
    onError: (error) => Toast('Failed to create task: ' + error.message, 5000),
  });

  const undoDeleteChatMutation = useMutation({
    mutationFn: (chatId) => undoDeleteChat(chatId),
    onSuccess: () => {
      invalidateChats();
      Toast('Task restored.', 2000);
    },
    onError: (error) => Toast('Failed to restore task: ' + error.message, 5000),
  });

  const deleteChatMutation = useMutation({
    mutationFn: (chatId) => apiDeleteChat(chatId),
    onSuccess: (data, chatId) => {
      if (currentChatId === chatId) {
        setCurrentChatId(null);
      }
      Toast('Task deleted.', 15000, () => undoDeleteChatMutation.mutate(chatId));
    },
    onSettled: async (data, error) => {
      await queryClient.invalidateQueries({ queryKey: ['chats'] });

      if (!error) {
        const chatsData = queryClient.getQueryData(['chats']);
        const totalChats = chatsData?.pages?.reduce((acc, page) => acc + (page.chats?.length || 0), 0) ?? 0;
        
        if (totalChats === 0 && !createChatMutation.isPending) {
          createChatMutation.mutate({ title: 'First Task', model: GEMINI_MODEL_NAME });
        }
      }
    },
    onError: (err) => {
      Toast('Failed to delete task: ' + err.message, 5000);
    },
  });

  const updateChatTitleMutation = useMutation({
    mutationFn: ({ id, title }) => apiUpdateChatTitle(id, title),
    onSuccess: invalidateChats,
    onError: (err) => Toast('Failed to update title: ' + err.message, 5000),
  });

  const handleCreateChat = useCallback((data = {}) => {
    if (createChatMutation.isPending) return;
    createChatMutation.mutate({ title: data.title || 'New Task', model: data.model || GEMINI_MODEL_NAME });
  }, [createChatMutation]);

  const handleDeleteChat = useCallback((chatId) => {
    if (deleteChatMutation.isPending || undoDeleteChatMutation.isPending) return;
    if (window.confirm('Are you sure you want to delete this task? This action can be undone from the notification.')) {
      deleteChatMutation.mutate(chatId);
    }
  }, [deleteChatMutation, undoDeleteChatMutation]);

  const isSessionBusy = createChatMutation.isPending ||
                        deleteChatMutation.isPending ||
                        undoDeleteChatMutation.isPending ||
                        updateChatTitleMutation.isPending;

  return {
    currentChatId,
    setCurrentChatId,
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat,
    updateChatTitle: updateChatTitleMutation.mutateAsync,
    isSessionBusy,
    isCreatingChat: createChatMutation.isPending,
  };
}
