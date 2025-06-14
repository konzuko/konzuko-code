// file: src/ChatPaneLayout.jsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { useVirtualizer } from '@tanstack/react-virtual';

const DEFAULT_TITLE = "Untitled Task";
const STATUS_INDICATOR_DURATION_MS = 2000;

const ChatItem = memo(function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat, disabled }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('idle');
  const [currentTitle, setCurrentTitle] = useState(chat.title || DEFAULT_TITLE);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) {
      setCurrentTitle(chat.title || DEFAULT_TITLE);
    }
  }, [chat.title, editing]);

  const finishEdit = async () => {
    setEditing(false);
    const originalTitle = chat.title || DEFAULT_TITLE;
    const trimmedTitle = currentTitle.trim();
    
    if (trimmedTitle && trimmedTitle !== originalTitle) {
      setStatus('processing');
      try {
        await onTitleUpdate({ id: chat.id, title: trimmedTitle });
        setStatus('success');
      } catch (error) {
        console.error("Failed to update title:", error);
        setStatus('error');
        setCurrentTitle(originalTitle);
      } finally {
        setTimeout(() => setStatus('idle'), STATUS_INDICATOR_DURATION_MS);
      }
    } else {
      setCurrentTitle(originalTitle); 
    }
  };
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  const handleDoubleClick = () => {
    if (!disabled && onTitleUpdate) setEditing(true);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (!disabled && onDeleteChat) onDeleteChat(chat.id);
  };

  return (
    <div
      className={`chat-item ${isActive ? 'active' : ''} ${disabled ? 'disabled': ''}`}
      onClick={() => {
        if (!disabled && onSelectChat) onSelectChat(chat.id);
      }}
    >
      <div className="chat-item-main">
        {editing ? (
          <input
            ref={inputRef}
            className="chat-item-input"
            value={currentTitle}
            onInput={e => setCurrentTitle(e.target.value)}
            onBlur={finishEdit}
            onKeyPress={handleKeyPress}
            onClick={e => e.stopPropagation()}
            autoFocus
            disabled={disabled}
          />
        ) : (
          <span 
            className="chat-item-title" 
            onDblClick={handleDoubleClick} 
            title={currentTitle}
          >
            {currentTitle}
          </span>
        )}
        {onDeleteChat && (
            <button
              className="button icon-button chat-item-delete"
              onClick={handleDelete}
              title="Delete Task"
              disabled={disabled}
            >
              Del
            </button>
        )}
      </div>
      <div className="chat-item-meta">
        {status === 'idle' && <>{chat.displayDate} {chat.displayTime}</>}
        {status === 'processing' && <span className="save-indicator saving">Processing...</span>}
        {status === 'success' && <span className="save-indicator success">✓ Saved</span>}
        {status === 'error' && <span className="save-indicator error">✗ Failed</span>}
      </div>
    </div>
  );
});

// FIX: Optimized date grouping logic
const groupChatsByDate = (chats) => {
  if (!chats || chats.length === 0) return [];
  
  const groups = [];
  const now = new Date();
  
  // Calculate date boundaries ONCE at the start
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000; // 24 * 60 * 60 * 1000
  const thisWeekStart = todayStart - ((now.getDay() + 6) % 7) * 86400000; // Monday is start of week
  const lastWeekStart = thisWeekStart - 7 * 86400000;
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  
  const monthFormatter = new Intl.DateTimeFormat('default', { month: 'long', year: 'numeric' });
  let currentGroupKey = null;

  for (const chat of chats) {
    const chatTime = chat.started ? Date.parse(chat.started) : 0;
    let groupTitle;
    let groupKey;

    if (chatTime >= todayStart) { groupTitle = 'Today'; groupKey = 'today'; }
    else if (chatTime >= yesterdayStart) { groupTitle = 'Yesterday'; groupKey = 'yesterday'; }
    else if (chatTime >= thisWeekStart) { groupTitle = 'This Week'; groupKey = 'this-week'; }
    else if (chatTime >= lastWeekStart) { groupTitle = 'Last Week'; groupKey = 'last-week'; }
    else if (chatTime >= thisMonthStart) { groupTitle = 'This Month'; groupKey = 'this-month'; }
    else if (chatTime > 0) {
      const chatDateObj = new Date(chatTime);
      groupTitle = monthFormatter.format(chatDateObj);
      groupKey = `${chatDateObj.getFullYear()}-${String(chatDateObj.getMonth() + 1).padStart(2, '0')}`;
    } else {
      groupTitle = 'Older'; groupKey = 'older';
    }

    if (groupKey !== currentGroupKey) {
      groups.push({ type: 'header', title: groupTitle, id: `header-${groupKey}-${groups.length}` });
      currentGroupKey = groupKey;
    }
    groups.push({ type: 'chat', chat, id: chat.id });
  }
  return groups;
};

export default function ChatPaneLayout({
  chats,
  currentChatId,
  onSelectChat,
  onTitleUpdate,
  onDeleteChat,
  disabled = false,
  hasMoreChatsToFetch,
  onLoadMoreChats,
  isLoadingMoreChats,
}) {
  const groupedItems = useMemo(() => groupChatsByDate(chats), [chats]);
  
  const parentRef = useRef(null);

  const itemCount = hasMoreChatsToFetch || chats.length > 0 ? groupedItems.length + 1 : groupedItems.length;

  const rowVirtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      if (index >= groupedItems.length) return 50;
      return groupedItems[index].type === 'header' ? 48 : 70;
    },
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastVirtualItem = virtualItems[virtualItems.length - 1];
  const lastVirtualItemIndex = lastVirtualItem ? lastVirtualItem.index : -1;

  useEffect(() => {
    if (!lastVirtualItem) return;

    if (
      lastVirtualItem.index >= groupedItems.length - 1 &&
      hasMoreChatsToFetch &&
      !isLoadingMoreChats
    ) {
      onLoadMoreChats();
    }
  }, [
    lastVirtualItemIndex,
    groupedItems.length,
    hasMoreChatsToFetch,
    isLoadingMoreChats,
    onLoadMoreChats,
  ]);

  return (
    <div ref={parentRef} className="chat-list-scroll-area">
      {itemCount > 0 && (
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {virtualItems.map((virtualItem) => {
            const isLoaderRow = virtualItem.index >= groupedItems.length;
            const item = isLoaderRow ? null : groupedItems[virtualItem.index];

            return (
              <div
                key={virtualItem.key}
                ref={virtualItem.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                  padding: '0 8px',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                {isLoaderRow ? (
                  <div className="load-more-sentinel">
                    {hasMoreChatsToFetch && (isLoadingMoreChats ? 'Loading...' : '')}
                    {!hasMoreChatsToFetch && chats.length > 0 && <div className="all-chats-loaded-indicator">All tasks loaded.</div>}
                  </div>
                ) : item.type === 'header' ? (
                  <div className="chat-group-header">{item.title}</div>
                ) : (
                  <ChatItem
                    chat={item.chat}
                    isActive={item.chat.id === currentChatId}
                    onSelectChat={onSelectChat}
                    onTitleUpdate={onTitleUpdate}
                    onDeleteChat={onDeleteChat}
                    disabled={disabled}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {chats?.length === 0 && !isLoadingMoreChats && (
          <div className="no-chats-indicator">No tasks yet. Create one!</div>
      )}
    </div>
  );
}
