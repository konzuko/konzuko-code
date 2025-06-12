// src/hooks/useMessageManager.js
import { useState, useCallback } from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  undoDeleteMessage,
  archiveMessagesAfter,
  callApiForText,
} from '../api.js';
import Toast from '../components/Toast.jsx';

export function useMessageManager(currentChatId, apiKey, setHasLastSendFailed) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['messages', currentChatId],
    queryFn: () => fetchMessages(currentChatId),
    enabled: !!currentChatId,
    staleTime: Infinity,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const messages = messagesData || [];

  const sendMessageMutation = useMutation({
    mutationFn: async (payload) => {
      const userRow = await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: payload.userMessageContentBlocks,
      });
      queryClient.setQueryData(['messages', currentChatId], (oldMessages = []) => [...oldMessages, userRow]);

      const messagesForApi = [...payload.existingMessages, userRow];
      const { content: assistantContent } = await callApiForText({
        apiKey: apiKey,
        messages: messagesForApi,
      });

      const assistantRow = await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
      return {
        userRow,
        assistantRow,
        onSendSuccess: payload.onSendSuccess,
      };
    },
    onMutate: async () => {
      setHasLastSendFailed?.(false); // Reset error state on new attempt
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      data.onSendSuccess?.();
    },
    onError: (error) => {
      Toast(`Error sending message: ${error.message}`, 8000);
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      setHasLastSendFailed?.(true); // Set error state on failure
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, newContentArray, originalMessages }) => {
      const editedMessage = await updateMessage(messageId, newContentArray);
      await archiveMessagesAfter(currentChatId, editedMessage.created_at);

      const editedMsgIndex = originalMessages.findIndex(m => m.id === messageId);
      if (editedMsgIndex === -1) throw new Error("Edited message not found for API call.");
      const messagesForApi = [...originalMessages.slice(0, editedMsgIndex), editedMessage];

      const { content: assistantContent } = await callApiForText({
        apiKey: apiKey,
        messages: messagesForApi,
      });
      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
      return { editedMessageId: messageId };
    },
    onMutate: async ({ messageId, newContentArray }) => {
      setHasLastSendFailed?.(false); // Reset
      const queryKey = ['messages', currentChatId];
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);

      queryClient.setQueryData(queryKey, (oldMessages = []) => {
        const originalEditedMessageIndex = oldMessages.findIndex(m => m.id === messageId);
        if (originalEditedMessageIndex === -1) return oldMessages;
        const originalEditedMessage = oldMessages[originalEditedMessageIndex];
        const optimisticallyUpdatedMessage = {
          ...originalEditedMessage,
          content: newContentArray,
          updated_at: new Date().toISOString(),
        };
        return oldMessages
          .map(msg => (msg.id === messageId ? optimisticallyUpdatedMessage : msg))
          .filter(msg => new Date(msg.created_at) <= new Date(optimisticallyUpdatedMessage.created_at))
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      });
      return { previousMessages };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      setEditingId(null);
      setEditText('');
    },
    onError: (error, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['messages', currentChatId], context.previousMessages);
      }
      Toast('Failed to edit message: ' + error.message, 5000);
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      setHasLastSendFailed?.(true); // Set on failure
    },
  });

  const resendMessageMutation = useMutation({
    mutationFn: async ({ messageId, originalMessages }) => {
      const anchorMessage = originalMessages.find(m => m.id === messageId);
      if (!anchorMessage) throw new Error("Anchor message for resend not found.");
      const anchorMsgIndex = originalMessages.findIndex(m => m.id === messageId);
      await archiveMessagesAfter(currentChatId, anchorMessage.created_at);
      const messagesForApi = originalMessages.slice(0, anchorMsgIndex + 1);
      const { content: assistantContent } = await callApiForText({
        apiKey: apiKey,
        messages: messagesForApi,
      });
      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
      return { resentMessageId: messageId };
    },
    onMutate: async () => {
        setHasLastSendFailed?.(false); // Reset
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      Toast('Message resent and conversation continued.', 3000);
    },
    onError: (error) => {
      Toast('Failed to resend message: ' + error.message, 5000);
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      setHasLastSendFailed?.(true); // Set on failure
    },
  });

  const undoDeleteMessageMutation = useMutation({
    mutationFn: (messageId) => undoDeleteMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      Toast('Message restored.', 2000);
    },
    onError: (error) => {
      Toast('Failed to undo message delete: ' + error.message, 5000);
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: (messageId) => deleteMessage(messageId),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: ['messages', currentChatId] });
      const previousMessages = queryClient.getQueryData(['messages', currentChatId]);
      queryClient.setQueryData(['messages', currentChatId], (oldMessages = []) =>
        oldMessages.filter(msg => msg.id !== messageId)
      );
      return { previousMessages, messageId };
    },
    onSuccess: (data, messageId) => {
      Toast('Message deleted.', 15000, () => {
        undoDeleteMessageMutation.mutate(messageId);
      });
    },
    onError: (err, messageId, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(['messages', currentChatId], context.previousMessages);
      }
      Toast('Failed to delete message: ' + err.message, 5000);
    },
  });

  const handleStartEdit = useCallback((msg) => {
    setEditingId(msg.id);
    const textContent = Array.isArray(msg.content)
      ? msg.content.find(b => b.type === 'text')?.text || ''
      : String(msg.content || '');
    setEditText(textContent);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !currentChatId || editMessageMutation.isPending) return;
    if (!apiKey || String(apiKey).trim() === "") {
      Toast("API Key not set. Cannot save edit.", 4000); return;
    }
    const originalMessage = messages.find(m => m.id === editingId);
    if (!originalMessage) {
      Toast("Original message not found for editing.", 4000);
      handleCancelEdit();
      return;
    }
    let newContentArray = [];
    if (Array.isArray(originalMessage.content)) {
      newContentArray = originalMessage.content.map(block =>
        block.type === 'text' ? { ...block, text: editText.trim() } : block
      );
      if (!newContentArray.some(b => b.type === 'text') && editText.trim() !== "") {
        newContentArray.push({ type: 'text', text: editText.trim() });
      }
    } else {
      newContentArray.push({ type: 'text', text: editText.trim() });
    }
    newContentArray = newContentArray.filter(block => block.type !== 'text' || (block.text && block.text.trim() !== ""));
    if (newContentArray.length === 0) {
      Toast("Cannot save an empty message.", 3000); return;
    }
    editMessageMutation.mutate({
      messageId: editingId,
      newContentArray: newContentArray,
      originalMessages: messages,
    });
  }, [editingId, editText, currentChatId, messages, editMessageMutation, apiKey, handleCancelEdit]);

  const handleResendMessage = useCallback((messageId) => {
    if (!currentChatId || resendMessageMutation.isPending) return;
    if (!apiKey || String(apiKey).trim() === "") {
      Toast("API Key not set. Cannot resend.", 4000); return;
    }
    resendMessageMutation.mutate({ messageId, originalMessages: messages });
  }, [currentChatId, messages, resendMessageMutation, apiKey]);

  const handleDeleteMessage = useCallback((messageId) => {
    if (deleteMessageMutation.isPending || !currentChatId) return;
    if (window.confirm('Are you sure you want to delete this message? You can undo this action from the toast.')) {
      deleteMessageMutation.mutate(messageId);
    }
  }, [deleteMessageMutation, currentChatId]);


  const isLoadingOps = sendMessageMutation.isPending ||
                       editMessageMutation.isPending ||
                       resendMessageMutation.isPending ||
                       deleteMessageMutation.isPending ||
                       undoDeleteMessageMutation.isPending;

  return {
    messages,
    isLoadingMessages,
    editingId,
    editText,
    setEditText,
    startEdit: handleStartEdit,
    cancelEdit: handleCancelEdit,
    saveEdit: handleSaveEdit,
    sendMessage: sendMessageMutation.mutate,
    resendMessage: handleResendMessage,
    deleteMessage: handleDeleteMessage,
    isLoadingOps,
    isSendingMessage: sendMessageMutation.isPending,
    isSavingEdit: editMessageMutation.isPending,
    isResendingMessage: resendMessageMutation.isPending,
  };
}
