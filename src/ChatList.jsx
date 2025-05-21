// src/ChatList.jsx
import { useEffect, useCallback } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME, createChat as apiCreateChat } from './api.js'; // Ensure apiCreateChat is imported
import ChatPaneLayout from './ChatPaneLayout.jsx';
import Toast from './components/Toast.jsx';

export default function ChatList({
  currentChatId,
  onSelectChat,
  // These are now passed from App.jsx, where the TQ mutations are defined
  onNewChatTrigger,      
  onDeleteChatTrigger,   
  onUpdateChatTitleTrigger,
  appDisabled 
}) {
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading: isLoadingChats,
    isFetchingNextPage,
    error: chatsError,
    isSuccess, 
  } = useInfiniteQuery({
    queryKey: ['chats'],
    queryFn: ({ pageParam = 1 }) => fetchChats({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 1,
  });

  const allChats = data
    ? data.pages.flatMap(page => page.chats?.map(r => ({ // Added optional chaining for page.chats
        id: r.id,
        title: r.title,
        started: r.created_at,
        model: r.code_type || GEMINI_MODEL_NAME,
        messages: [] 
      })) || []) // Ensure flatMap input is always an array
    : [];

  // Effect for creating an initial chat if none exist (runs only once after successful fetch)
  useEffect(() => {
    if (isSuccess && data && data.pages[0]?.totalCount === 0 && !isLoadingChats) {
      // Check if a chat creation is already in progress or just finished to avoid loops
      const existingChatCreation = queryClient.getMutationCache().getAll().find(m => m.options.mutationKey?.[0] === 'createChat' && m.state.status === 'pending');
      const chatsQueryData = queryClient.getQueryState(['chats']);
      
      if (!existingChatCreation && chatsQueryData && chatsQueryData.data && chatsQueryData.data.pages[0]?.totalCount === 0) {
        console.log("[ChatList] No chats found on server, triggering initial chat creation via prop.");
        if (onNewChatTrigger) { // Use the trigger from App.jsx
            onNewChatTrigger({ title: 'First Chat', model: GEMINI_MODEL_NAME });
        }
      }
    }
  }, [isSuccess, data, isLoadingChats, queryClient, onNewChatTrigger]);
  
  // Auto-select first chat if none is selected and chats are loaded
  useEffect(() => {
    if (!currentChatId && allChats.length > 0 && onSelectChat) {
        onSelectChat(allChats[0].id);
    }
  }, [currentChatId, allChats, onSelectChat]); // allChats reference changes when data re-fetches

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);


  if (isLoadingChats && !data?.pages?.length) { // Show loader only if no pages are loaded yet
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
      // Pass down the mutation triggers from App.jsx
      onNewChat={onNewChatTrigger}       
      onTitleUpdate={onUpdateChatTitleTrigger} 
      onDeleteChat={onDeleteChatTrigger}   
      
      disabled={appDisabled || isLoadingChats} // Disable if initial load is happening
      
      hasMoreChatsToFetch={hasNextPage}
      onLoadMoreChats={handleLoadMore}
      isLoadingMoreChats={isFetchingNextPage}
    />
  );
}
