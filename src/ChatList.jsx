/* src/ChatList.jsx */
// src/ChatList.jsx
import { useEffect, useCallback, useRef } from 'preact/hooks';
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
  const initialLogicRan = useRef(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    error: chatsError,
    status, // Use status for more reliable state checks: 'pending', 'error', 'success'
  } = useInfiniteQuery({
    queryKey: ['chats'],
    queryFn: ({ pageParam = 1 }) => fetchChats({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 1,
    staleTime: 1000 * 60 * 30, // 30 minutes
    onSuccess: (data) => {
      if (initialLogicRan.current || !data) return;
      
      const allChatsFlat = data.pages.flatMap(page => page.chats || []);
      
      if (allChatsFlat.length > 0) {
        const currentChatIsValid = allChatsFlat.some(chat => String(chat.id) === String(currentChatId));
        if (!currentChatId || !currentChatIsValid) {
          console.log('[ChatList onSuccess] Current chat invalid or missing, selecting newest.');
          onSelectChat(allChatsFlat[0].id);
        }
      } else {
        console.log('[ChatList onSuccess] No chats found, creating first task.');
        onNewChatTrigger({ title: 'First Task', model: GEMINI_MODEL_NAME });
      }
      initialLogicRan.current = true;
    }
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

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (status === 'pending') {
    return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading tasks...</div>;
  }

  if (status === 'error') {
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
      disabled={appDisabled || isFetching} // Disable controls if any fetch is in progress
      hasMoreChatsToFetch={hasNextPage}
      onLoadMoreChats={handleLoadMore}
      isLoadingMoreChats={isFetchingNextPage}
    />
  );
}
