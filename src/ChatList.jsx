// file: src/ChatList.jsx
import { useMemo, useCallback, useRef, useEffect } from 'preact/hooks';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchChats, GEMINI_MODEL_NAME } from './api.js';
import ChatPaneLayout from './ChatPaneLayout.jsx';
import { useSettings } from './contexts/SettingsContext.jsx';
import { useChat } from './contexts/ChatContext.jsx';

export default function ChatList({ appDisabled }) {
  const { collapsed, handleToggleCollapse } = useSettings();
  const { 
    currentChatId, 
    setCurrentChatId, 
    createChat, 
    deleteChat, 
    updateChatTitle 
  } = useChat();
  const initialLogicRan = useRef(false);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    error: chatsError,
    status,
    isSuccess,
  } = useInfiniteQuery({
    queryKey: ['chats'],
    queryFn: ({ pageParam = 1 }) => fetchChats({ pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 1,
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    if (isSuccess && !initialLogicRan.current && data) {
      const allChatsFlat = data.pages.flatMap(p => p.chats || []);
      if (allChatsFlat.length === 0) {
        createChat({ title: 'First Task', model: GEMINI_MODEL_NAME });
      } else {
        const valid = allChatsFlat.some(c => String(c.id) === String(currentChatId));
        if (!valid) setCurrentChatId(allChatsFlat[0].id);
      }
      initialLogicRan.current = true;
    }
  }, [isSuccess, data, currentChatId, createChat, setCurrentChatId]);

  const allChats = useMemo(() => {
    if (!data) return [];
    const dOpt = { day: 'numeric', month: 'short' };
    const tOpt = { hour: '2-digit', minute: '2-digit' };
    return data.pages.flatMap(page =>
      (page.chats || []).map(row => {
        const ts = row.created_at ? new Date(row.created_at) : new Date();
        return {
          id: row.id,
          title: row.title,
          started: row.created_at,
          model: row.code_type || GEMINI_MODEL_NAME,
          messages: [],
          displayDate: ts.toLocaleDateString([], dOpt),
          displayTime: ts.toLocaleTimeString([], tOpt)
        };
      })
    );
  }, [data]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (status === 'pending') {
    return (
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading tasks…
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div style={{ padding: '1rem', color: 'var(--error)' }}>
          Error loading tasks: {chatsError.message}
        </div>
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
          <button
            className="button new-chat-button"
            disabled={appDisabled}
            onClick={() => createChat()}
          >
            New Task
          </button>
        </div>
      )}

      <ChatPaneLayout
        chats={allChats}
        currentChatId={currentChatId}
        onSelectChat={setCurrentChatId}
        onTitleUpdate={updateChatTitle}
        onDeleteChat={deleteChat}
        disabled={appDisabled || isFetching}
        hasMoreChatsToFetch={hasNextPage}
        onLoadMoreChats={handleLoadMore}
        isLoadingMoreChats={isFetchingNextPage}
      />
    </div>
  );
}
