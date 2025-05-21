// src/ChatList.jsx
import { useEffect } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, createChat as apiCreateChat, GEMINI_MODEL_NAME } from './api.js';
import ChatPaneLayout from './ChatPaneLayout.jsx';
import Toast from './components/Toast.jsx';

export default function ChatList({
  currentChatId,
  onSelectChat,
  // onNewChat, // Will be handled internally or via TQ mutation passed from App
  // onTitleUpdate, // Will be handled via TQ mutation
  // onDeleteChat, // Will be handled via TQ mutation
  appDisabled // General disabled state from App
}) {
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading: isLoadingChats,
    isFetchingNextPage,
    error: chatsError,
    isSuccess, // Added to check if initial fetch was successful
  } = useInfiniteQuery({
    queryKey: ['chats'],
    queryFn: ({ pageParam = 1 }) => fetchChats({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 1,
  });

  const allChats = data
    ? data.pages.flatMap(page => page.chats.map(r => ({
        id: r.id,
        title: r.title,
        started: r.created_at,
        model: r.code_type || GEMINI_MODEL_NAME,
        messages: [] // Messages are fetched separately based on currentChatId
      })))
    : [];

  // Handle automatic creation of a new chat if none exist after initial load
  useEffect(() => {
    if (isSuccess && data && data.pages[0]?.totalCount === 0 && allChats.length === 0) {
      // No chats exist, let's create one.
      // This mutation could also live in App.jsx if it needs more global side effects.
      (async () => {
        try {
          console.log("No chats found, attempting to create an initial chat.");
          const newChat = await apiCreateChat({ title: 'New Chat' });
          queryClient.invalidateQueries({ queryKey: ['chats'] });
          if (newChat && newChat.id) {
            onSelectChat(newChat.id); // Select the newly created chat
          }
        } catch (err) {
          Toast('Failed to create initial chat: ' + err.message, 5000);
          console.error("Failed to create initial chat:", err);
        }
      })();
    }
  }, [isSuccess, data, allChats.length, queryClient, onSelectChat]);
  
  // Auto-select first chat if none is selected and chats are loaded
  useEffect(() => {
    if (!currentChatId && allChats.length > 0) {
        onSelectChat(allChats[0].id);
    }
  }, [currentChatId, allChats, onSelectChat]);


  if (isLoadingChats && !data) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chats...</div>;
  }

  if (chatsError) {
    return <div style={{ padding: '1rem', color: 'var(--error)' }}>Error loading chats: {chatsError.message}</div>;
  }

  return (
    <ChatPaneLayout
      chats={allChats}
      currentChatId={currentChatId}
      onSelectChat={onSelectChat}
      // Pass down functions for create/delete/update that App.jsx will provide (wired to TQ mutations)
      // These are placeholders for now, App.jsx will provide the TQ-ified versions
      onNewChat={() => queryClient.executeMutation({ mutationKey: ['createChat']})} // Example, actual call from App
      onTitleUpdate={(id, title) => {/* call updateChatMutation from App */}}
      onDeleteChat={(id) => {/* call deleteChatMutation from App */}}
      
      disabled={appDisabled || isLoadingChats || isFetchingNextPage}
      
      hasMoreChatsToFetch={hasNextPage}
      onLoadMoreChats={fetchNextPage}
      isLoadingMoreChats={isFetchingNextPage}
    />
  );
}
