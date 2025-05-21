// src/ChatList.jsx
import { useEffect, useCallback } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME } from './api.js'; 
import ChatPaneLayout from './ChatPaneLayout.jsx';
import Toast from './components/Toast.jsx';

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
    // refetchOnMount: true, // Default is true, keep it
    // refetchOnWindowFocus: true, // Default is true, keep it for 30 min staleTime
    // refetchOnReconnect: true, // Default is true, keep it
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
    if (isSuccess && data && data.pages[0]?.totalCount === 0 && !isLoadingChats) {
      const existingChatCreation = queryClient.getMutationCache().getAll().find(m => m.options.mutationKey?.[0] === 'createChat' && m.state.status === 'pending');
      const chatsQueryData = queryClient.getQueryState(['chats']);
      
      if (!existingChatCreation && chatsQueryData && chatsQueryData.data && chatsQueryData.data.pages[0]?.totalCount === 0) {
        if (onNewChatTrigger) { 
            onNewChatTrigger({ title: 'First Chat', model: GEMINI_MODEL_NAME });
        }
      }
    }
  }, [isSuccess, data, isLoadingChats, queryClient, onNewChatTrigger]);
  
  useEffect(() => {
    if (!currentChatId && allChats.length > 0 && onSelectChat) {
        onSelectChat(allChats[0].id);
    }
  }, [currentChatId, allChats, onSelectChat]); 

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

