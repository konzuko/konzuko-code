// src/ChatList.jsx
import { useEffect, useCallback } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME } from './api.js';
import ChatPaneLayout from './ChatPaneLayout.jsx';

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
    // isLoading: isLoadingChats, // isLoading is true only for the initial fetch (status === 'pending')
    isFetching, // isFetching is true for initial fetch AND subsequent refetches (fetchStatus === 'fetching')
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
    // Only run this logic if the chats query has successfully loaded at least once
    // AND is NOT actively fetching new data.
    if (isSuccess && !isFetching && onSelectChat) {
      if (allChats.length > 0) {
        if (currentChatId) {
          const currentChatIdStr = String(currentChatId);
          const storedChatExists = allChats.some(chat => String(chat.id) === currentChatIdStr);
          if (!storedChatExists) {
            // This log indicates that the currentChatId (likely from localStorage or a recent set)
            // isn't in the fully loaded, settled list of chats. This is a valid scenario to correct.
            console.warn(`[ChatList] Chat ID ${currentChatId} not found in the current fully loaded list. Selecting newest task.`);
            onSelectChat(allChats[0].id); // Select the first (newest) chat
          }
          // If storedChatExists, currentChatId is valid and already set.
        } else {
          // No currentChatId is set (e.g., first ever load, or it was cleared).
          // Select the newest chat from the fully loaded list.
          onSelectChat(allChats[0].id);
        }
      } else { // No chats exist at all (allChats.length === 0) and data is settled.
        const existingChatCreation = queryClient.getMutationCache().getAll().find(m => m.options.mutationKey?.[0] === 'createChat' && m.state.status === 'pending');
        const chatsQueryData = queryClient.getQueryState(['chats']);
        const totalChatsInQuery = chatsQueryData?.data?.pages?.[0]?.totalCount ?? 0;
        const noChatsInData = chatsQueryData?.data?.pages?.every(p => p.chats.length === 0) ?? false;

        // If no chat creation is pending and the settled query data confirms no chats, trigger "First Task".
        if (!existingChatCreation && (totalChatsInQuery === 0 || (totalChatsInQuery > 0 && noChatsInData))) {
          if (onNewChatTrigger) {
              onNewChatTrigger({ title: 'First Task', model: GEMINI_MODEL_NAME });
          }
        }
      }
    }
  }, [
    currentChatId,
    allChats, // Using allChats here is fine as it's derived from `data` which `isFetching` guards.
    onSelectChat,
    isSuccess,
    isFetching, // Key change: use isFetching instead of isLoadingChats
    onNewChatTrigger,
    queryClient
  ]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // For initial loading UI, we can still use `isFetching` and check if pages exist
  if (isFetching && (!data || data.pages.length === 0)) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading tasks...</div>;
  }

  if (chatsError) {
    return <div style={{ padding: '1rem', color: 'var(--error)' }}>Error loading tasks: {chatsError.message}</div>;
  }

  return (
    <ChatPaneLayout
      chats={allChats}
      currentChatId={currentChatId}
      onSelectChat={onSelectChat}
      onNewChat={onNewChatTrigger}
      onTitleUpdate={onUpdateChatTitleTrigger}
      onDeleteChat={onDeleteChatTrigger}
      disabled={appDisabled || isFetching} // Disable controls if fetching
      hasMoreChatsToFetch={hasNextPage}
      onLoadMoreChats={handleLoadMore}
      isLoadingMoreChats={isFetchingNextPage}
    />
  );
}
