// file: src/ChatList.jsx
import { useMemo, useCallback, useRef } from 'preact/hooks';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME } from './api.js';
import ChatPaneLayout from './ChatPaneLayout.jsx';
import { useSettings } from './contexts/SettingsContext.jsx';

export default function ChatList({
  currentChatId,
  onSelectChat,
  onNewChatTrigger,
  onDeleteChatTrigger,
  onUpdateChatTitleTrigger,
  appDisabled,
}) {
  const queryClient = useQueryClient();
  const { collapsed, handleToggleCollapse } = useSettings();
  const initialLogicRan = useRef(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    error: chatsError,
    status,
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

  const allChats = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap(page => page.chats?.map(r => ({
        id: r.id,
        title: r.title,
        started: r.created_at,
        model: r.code_type || GEMINI_MODEL_NAME,
        messages: []
      })) || []);
  }, [data]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (status === 'pending') {
    return (
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading tasks...</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div style={{ padding: '1rem', color: 'var(--error)' }}>Error loading tasks: {chatsError.message}</div>
      </div>
    );
  }

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {!collapsed && (
        <div className="sidebar-header flex space-between align-center">
          <button
            className="button icon-button sidebar-collapse-toggle is-open"
            onClick={handleToggleCollapse}
            title="Collapse Sidebar"
          >
            {'«'}
          </button>
          <button className="button new-chat-button" onClick={onNewChatTrigger} disabled={appDisabled}>
            New Task
          </button>
        </div>
      )}
      <ChatPaneLayout
        chats={allChats}
        currentChatId={currentChatId}
        onSelectChat={onSelectChat}
        onTitleUpdate={onUpdateChatTitleTrigger}
        onDeleteChat={onDeleteChatTrigger}
        disabled={appDisabled || isFetching}
        hasMoreChatsToFetch={hasNextPage}
        onLoadMoreChats={handleLoadMore}
        isLoadingMoreChats={isFetchingNextPage}
      />
    </div>
  );
}
