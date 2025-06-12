// src/ChatPaneLayout.jsx
// Ensure all props are correctly received and used.
import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';

const DEFAULT_TITLE = "Untitled Task";

// This component uses local state (`currentTitle`) for its title display.
// This provides an instant visual update for the user, decoupling the UI
// from the slower database save operation, which is handled in the background.
function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat, disabled }) {
  const [editing, setEditing] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(chat.title || DEFAULT_TITLE);

  // This effect syncs the local title with the parent prop.
  // CRITICAL: It does NOT run while editing, to prevent a race condition
  // where a background data refresh could wipe out the user's input.
  useEffect(() => {
    if (!editing) {
      setCurrentTitle(chat.title || DEFAULT_TITLE);
    }
  }, [chat.title, editing]);

  const ts    = chat.started ? new Date(chat.started) : new Date();
  const date  = ts.toLocaleDateString([], { day: 'numeric', month: 'short'});
  const time  = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const finishEdit = () => {
    setEditing(false);
    const trimmedTitle = currentTitle.trim();
    // Only call the update function if the title has actually changed and is not empty.
    if (trimmedTitle && trimmedTitle !== (chat.title || DEFAULT_TITLE)) {
      // The UI has already updated visually. Now, trigger the background save.
      onTitleUpdate(chat.id, trimmedTitle);
    } else {
      // If the title is empty or unchanged, revert local state to match the prop.
      setCurrentTitle(chat.title || DEFAULT_TITLE); 
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
            className="chat-item-input"
            value={currentTitle}
            onInput={e => setCurrentTitle(e.target.value)}
            onBlur={finishEdit}
            onKeyPress={e => e.key === 'Enter' && finishEdit()}
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
        {date} {time}
      </div>
    </div>
  );
}

const groupChatsByDate = (chats) => {
  if (!chats || chats.length === 0) return [];
  const groups = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = new Date(new Date(todayStart).setDate(new Date(todayStart).getDate() - 1)).getTime();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; 
  const thisWeekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const thisWeekStart = thisWeekStartDate.getTime();
  const lastWeekStartDate = new Date(thisWeekStartDate);
  lastWeekStartDate.setDate(thisWeekStartDate.getDate() - 7);
  const lastWeekStart = lastWeekStartDate.getTime();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let currentGroupKey = null;

  chats.forEach(chat => {
    const chatTime = chat.started ? new Date(chat.started).getTime() : 0;
    let groupTitle;
    let groupKey;

    if (chatTime >= todayStart) { groupTitle = 'Today'; groupKey = 'today'; }
    else if (chatTime >= yesterdayStart) { groupTitle = 'Yesterday'; groupKey = 'yesterday'; }
    else if (chatTime >= thisWeekStart) { groupTitle = 'This Week'; groupKey = 'this-week'; }
    else if (chatTime >= lastWeekStart) { groupTitle = 'Last Week'; groupKey = 'last-week'; }
    else if (chatTime >= thisMonthStart) { groupTitle = 'This Month'; groupKey = 'this-month'; }
    else if (chatTime > 0) {
      const chatDateObj = new Date(chat.started);
      groupTitle = chatDateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
      groupKey = `${chatDateObj.getFullYear()}-${String(chatDateObj.getMonth() + 1).padStart(2, '0')}`;
    } else {
      groupTitle = 'Older'; groupKey = 'older'; // Fallback for chats with no/invalid date
    }

    if (groupKey !== currentGroupKey) {
      groups.push({ type: 'header', title: groupTitle, id: `header-${groupKey}-${groups.length}` });
      currentGroupKey = groupKey;
    }
    groups.push({ type: 'chat', chat, id: chat.id });
  });
  return groups;
};

export default function ChatPaneLayout({
  chats,
  currentChatId,
  onSelectChat,
  onNewChat,
  onTitleUpdate,
  onDeleteChat,
  disabled = false,
  hasMoreChatsToFetch,
  onLoadMoreChats,
  isLoadingMoreChats
}) {
  const [collapsed, setCollapsed] = useState(false);

  const groupedItems = useMemo(() => groupChatsByDate(chats), [chats]);

  const observer = useRef();
  const loadMoreSentinelRef = useCallback(node => {
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreChatsToFetch && !isLoadingMoreChats && !disabled) {
        onLoadMoreChats();
      }
    });
    if (node) observer.current.observe(node);
  }, [hasMoreChatsToFetch, onLoadMoreChats, isLoadingMoreChats, disabled]);

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header flex space-between align-center">
        <button
          className="button icon-button sidebar-collapse-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {collapsed ? '»' : '«'}
        </button>
        {!collapsed && onNewChat && (
          <button className="button new-chat-button" onClick={onNewChat} disabled={disabled}>
            New Task
          </button>
        )}
      </div>

      <div className="chat-list-scroll-area">
        {!collapsed && groupedItems.map(item => {
          if (item.type === 'header') {
            return <div key={item.id} className="chat-group-header">{item.title}</div>;
          }
          return (
            <ChatItem
              key          ={item.chat.id}
              chat         ={item.chat}
              isActive     ={item.chat.id === currentChatId}
              onSelectChat ={onSelectChat}
              onTitleUpdate={onTitleUpdate}
              onDeleteChat ={onDeleteChat}
              disabled     ={disabled}
            />
          );
        })}
        {!collapsed && hasMoreChatsToFetch && (
          <div ref={loadMoreSentinelRef} className="load-more-sentinel">
            {isLoadingMoreChats && <span>Loading...</span>}
          </div>
        )}
        {!collapsed && !isLoadingMoreChats && !hasMoreChatsToFetch && chats?.length > 0 && (
            <div className="all-chats-loaded-indicator">All tasks loaded.</div>
        )}
        {!collapsed && !isLoadingMoreChats && chats?.length === 0 && (
            <div className="no-chats-indicator">No tasks yet. Create one!</div>
        )}
      </div>
    </div>
  );
}
