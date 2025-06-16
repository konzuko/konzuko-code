// file: src/hooks/useMessageManager.js
import { useState, useCallback } from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  undoDeleteMessage,
  archiveMessagesAfter,
} from '../api/supabaseApi.js';
import { callApiForText } from '../api/geminiApi.js';
import Toast from '../components/Toast.jsx';

export function useMessageManager(currentChatId, setHasLastSendFailed) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['messages', currentChatId],
    queryFn: () => fetchMessages(currentChatId),
    enabled: !!currentChatId,
    staleTime: 1000 * 60 * 5,
  });

  const invalidateMessages = () => {
    queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
  };

  const sendMessageMutation = useMutation({
    mutationFn: async (payload) => {
      const { userMessageContentBlocks, existingMessages, apiKey } = payload;
      
      const userRow = await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: userMessageContentBlocks,
      });

      invalidateMessages();

      const messagesForApi = [...existingMessages, userRow];
      const { content: assistantContent } = await callApiForText({
        apiKey: apiKey,
        messages: messagesForApi,
      });

      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
    },
    onMutate: () => setHasLastSendFailed?.(false),
    onSuccess: invalidateMessages,
    onError: (error) => {
      Toast(`Error sending message: ${error.message}`, 8000);
      invalidateMessages();
      setHasLastSendFailed?.(true);
    },
  });

  const updateMessageMutation = useMutation({
    mutationFn: ({ messageId, newContentArray }) => updateMessage(messageId, newContentArray),
    onSuccess: () => {
      invalidateMessages();
      setEditingId(null);
      setEditText('');
      Toast('Message updated.', 3000);
    },
    onError: (err) => Toast(`Failed to update message: ${err.message}`, 5000),
  });

  const forkConversationMutation = useMutation({
    mutationFn: async ({ messageId, newContentArray, apiKey }) => {
      const originalMessages = queryClient.getQueryData(['messages', currentChatId]) || [];
      const editedMessage = await updateMessage(messageId, newContentArray);
      await archiveMessagesAfter(currentChatId, editedMessage.created_at);

      const editedMsgIndex = originalMessages.findIndex(m => m.id === messageId);
      if (editedMsgIndex === -1) throw new Error("Edited message not found for API call.");
      const messagesForApi = [...originalMessages.slice(0, editedMsgIndex), editedMessage];

      const { content: assistantContent } = await callApiForText({ apiKey, messages: messagesForApi });
      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
    },
    onSuccess: () => {
      invalidateMessages();
      setEditingId(null);
      setEditText('');
      Toast('Fork successful. All subsequent messages removed.', 3000);
    },
    onError: (error) => {
      Toast('Failed to fork: ' + error.message, 5000);
      invalidateMessages();
      setHasLastSendFailed?.(true);
    },
  });

  const resendMessageMutation = useMutation({
    mutationFn: async ({ messageId, apiKey }) => {
      const originalMessages = queryClient.getQueryData(['messages', currentChatId]) || [];
      const anchorMessage = originalMessages.find(m => m.id === messageId);
      if (!anchorMessage) throw new Error("Anchor message for resend not found.");
      
      await archiveMessagesAfter(currentChatId, anchorMessage.created_at);
      const anchorMsgIndex = originalMessages.findIndex(m => m.id === messageId);
      const messagesForApi = originalMessages.slice(0, anchorMsgIndex + 1);
      
      const { content: assistantContent } = await callApiForText({ apiKey, messages: messagesForApi });
      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }],
      });
    },
    onMutate: () => setHasLastSendFailed?.(false),
    onSuccess: () => {
      invalidateMessages();
      Toast('Message resent and conversation continued.', 3000);
    },
    onError: (error) => {
      Toast('Failed to resend message: ' + error.message, 5000);
      invalidateMessages();
      setHasLastSendFailed?.(true);
    },
  });

  const undoDeleteMessageMutation = useMutation({
    mutationFn: (messageId) => undoDeleteMessage(messageId),
    onSuccess: () => {
      invalidateMessages();
      Toast('Message restored.', 2000);
    },
    onError: (error) => Toast('Failed to undo message delete: ' + error.message, 5000),
  });

  const deleteMessageMutation = useMutation({
    mutationFn: (messageId) => deleteMessage(messageId),
    onSuccess: (data, messageId) => {
      invalidateMessages();
      Toast('Message deleted.', 15000, () => undoDeleteMessageMutation.mutate(messageId));
    },
    onError: (err) => Toast('Failed to delete message: ' + err.message, 5000),
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

  const handleSaveEdit = useCallback((apiKey) => {
    if (!editingId || !currentChatId) return;
    if (forkConversationMutation.isPending || updateMessageMutation.isPending) return;
    if (!apiKey) { Toast("API Key not set.", 4000); return; }

    const originalMessage = messages.find(m => m.id === editingId);
    if (!originalMessage) { Toast("Original message not found.", 4000); handleCancelEdit(); return; }

    let newContentArray = Array.isArray(originalMessage.content)
      ? originalMessage.content.map(b => b.type === 'text' ? { ...b, text: editText.trim() } : b)
      : [{ type: 'text', text: editText.trim() }];
    if (!newContentArray.some(b => b.type === 'text') && editText.trim()) {
      newContentArray.push({ type: 'text', text: editText.trim() });
    }
    newContentArray = newContentArray.filter(b => b.type !== 'text' || b.text.trim());
    if (newContentArray.length === 0) { Toast("Cannot save an empty message.", 3000); return; }

    const isLastMessage = messages.length > 0 && messages[messages.length - 1].id === editingId;
    if (isLastMessage) {
      updateMessageMutation.mutate({ messageId: editingId, newContentArray });
    } else {
      forkConversationMutation.mutate({ messageId: editingId, newContentArray, apiKey });
    }
  }, [editingId, editText, currentChatId, messages, forkConversationMutation, updateMessageMutation, handleCancelEdit, apiKey]); // <-- FIX: Added apiKey

  const handleResendMessage = useCallback((messageId, apiKey) => {
    if (!currentChatId || resendMessageMutation.isPending) return;
    if (!apiKey) { Toast("API Key not set.", 4000); return; }
    resendMessageMutation.mutate({ messageId, apiKey });
  }, [currentChatId, resendMessageMutation, apiKey]); // <-- FIX: Added apiKey

  const handleDeleteMessage = useCallback((messageId) => {
    if (deleteMessageMutation.isPending || !currentChatId) return;
    if (window.confirm('Are you sure you want to delete this message? You can undo this action from the toast.')) {
      deleteMessageMutation.mutate(messageId);
    }
  }, [deleteMessageMutation, currentChatId]);

  const isLoadingOps = sendMessageMutation.isPending ||
                       forkConversationMutation.isPending ||
                       updateMessageMutation.isPending ||
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
    isForking: forkConversationMutation.isPending,
    isResendingMessage: resendMessageMutation.isPending,
  };
}
