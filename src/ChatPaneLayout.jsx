// src/ChatPaneLayout.jsx
// Ensure all props are correctly received and used.
import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';

function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat, disabled }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle]     = useState(chat.title || "Untitled Chat"); // Default title

  useEffect(() => {
    setTitle(chat.title || "Untitled Chat");
  }, [chat.title]);

  const ts    = chat.started ? new Date(chat.started) : new Date(); // Handle undefined started
  const date  = ts.toLocaleDateString([], { day: 'numeric', month: 'short'});
  const time  = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const finishEdit = () => {
    setEditing(false);
    const trimmedTitle = title.trim();
    if (trimmedTitle && trimmedTitle !== (chat.title || "Untitled Chat")) {
      onTitleUpdate(chat.id, trimmedTitle);
    } else {
      setTitle(chat.title || "Untitled Chat"); 
    }
  };
  
  const handleDoubleClick = () => {
    if (!disabled && onTitleUpdate) setEditing(true); // Only allow edit if onTitleUpdate is provided
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
            value={title}
            onInput={e => setTitle(e.target.value)}
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
            title={chat.title || "Untitled Chat"}
          >
            {chat.title || "Untitled Chat"}
          </span>
        )}
        {onDeleteChat && ( // Only show delete button if handler is provided
            <button
              className="button icon-button chat-item-delete"
              onClick={handleDelete}
              title="Delete Chat"
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

  // Chats should already be sorted by `useInfiniteQuery` (newest first from API)
  // `groupChatsByDate` will handle the display grouping.
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
        {!collapsed && onNewChat && ( // Only show if handler is provided
          <button className="button new-chat-button" onClick={onNewChat} disabled={disabled}>
            New Chat
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
              onTitleUpdate={onTitleUpdate} // Pass down if implemented
              onDeleteChat ={onDeleteChat}   // Pass down
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
            <div className="all-chats-loaded-indicator">All chats loaded.</div>
        )}
        {!collapsed && !isLoadingMoreChats && chats?.length === 0 && ( // Check for chats.length
            <div className="no-chats-indicator">No chats yet. Create one!</div>
        )}
      </div>
    </div>
  );
}