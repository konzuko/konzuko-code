// src/ChatList.jsx
import { useEffect, useCallback } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME } from './api.js'; 
import ChatPaneLayout from './ChatPaneLayout.jsx';
// Toast is not used directly in this file anymore
// import Toast from './components/Toast.jsx'; 

export default function ChatList({
  currentChatId,
  onSelectChat,
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
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const allChats = data
    ? data.pages.flatMap(page => page.chats?.map(r => ({ 
        id: r.id,
        title: r.title,
        started: r.created_at,
        model: r.code_type || GEMINI_MODEL_NAME,
        messages: [] 
      })) || []) 
    : [];

  useEffect(() => {
    // This effect handles:
    // 1. Validating a localStorage-loaded currentChatId against the fetched chat list.
    // 2. Selecting the newest chat if no currentChatId is set or if the stored one is invalid.
    // 3. Triggering "First Chat" creation if no chats exist at all.
    if (isSuccess && !isLoadingChats && onSelectChat) { // Ensure data is loaded, not currently loading, and onSelectChat is available
      if (allChats.length > 0) {
        if (currentChatId) {
          const currentChatIdStr = String(currentChatId); // Ensure comparison with string IDs if necessary
          const storedChatExists = allChats.some(chat => String(chat.id) === currentChatIdStr);
          if (!storedChatExists) {
            console.warn(`[ChatList] Stored chat ID ${currentChatId} not found. Selecting newest chat.`);
            onSelectChat(allChats[0].id); // Select the first (newest) chat
          }
          // If storedChatExists, currentChatId is valid and already set, App.jsx will handle loading its messages.
        } else {
          // No currentChatId (either initially null, or reset because invalid by a previous run of this effect, or cleared).
          // Select the newest chat.
          onSelectChat(allChats[0].id);
        }
      } else { // No chats exist at all (allChats.length === 0)
        // This is where the "First Chat" creation logic is triggered
        const existingChatCreation = queryClient.getMutationCache().getAll().find(m => m.options.mutationKey?.[0] === 'createChat' && m.state.status === 'pending');
        
        // Check the source of truth for total chats from the query data itself,
        // as `allChats` might be empty during an intermediate render.
        const chatsQueryData = queryClient.getQueryState(['chats']);
        const totalChatsInQuery = chatsQueryData?.data?.pages?.[0]?.totalCount ?? 0;
        // Also consider if the query itself has pages but those pages are empty
        const noChatsInData = chatsQueryData?.data?.pages?.every(p => p.chats.length === 0) ?? false;


        if (!existingChatCreation && (totalChatsInQuery === 0 || (totalChatsInQuery > 0 && noChatsInData))) {
          if (onNewChatTrigger) { 
              onNewChatTrigger({ title: 'First Chat', model: GEMINI_MODEL_NAME });
          }
        }
      }
    }
  }, [
    currentChatId, 
    allChats, // Derived from data, but useful for readability
    data, // Actual query data
    onSelectChat, 
    isSuccess, 
    isLoadingChats, 
    onNewChatTrigger, 
    queryClient
  ]);
  
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);


  if (isLoadingChats && !data?.pages?.length) { 
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
      onNewChat={onNewChatTrigger}       
      onTitleUpdate={onUpdateChatTitleTrigger} 
      onDeleteChat={onDeleteChatTrigger}   
      disabled={appDisabled || isLoadingChats} 
      hasMoreChatsToFetch={hasNextPage}
      onLoadMoreChats={handleLoadMore}
      isLoadingMoreChats={isFetchingNextPage}
    />
  );
}
