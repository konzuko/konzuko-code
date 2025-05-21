// src/ChatPaneLayout.jsx
// This is the refactored version of the original chatpane.jsx, focusing on presentation.
import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';

// ChatItem component (assuming it's defined here or imported)
function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat, disabled }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle]     = useState(chat.title);

  useEffect(() => { // Sync title if chat prop changes (e.g. after TQ refetch)
    setTitle(chat.title);
  }, [chat.title]);

  const ts    = new Date(chat.started);
  const date  = ts.toLocaleDateString([], { day: 'numeric', month: 'short'}); // Keep it concise
  const time  = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const finishEdit = () => {
    setEditing(false);
    if (title.trim() && title !== chat.title) {
      onTitleUpdate(chat.id, title.trim());
    } else {
      setTitle(chat.title); // Reset if no change or empty
    }
  };
  
  const handleDoubleClick = () => {
    if (!disabled) setEditing(true);
  };

  return (
    <div
      className={`chat-item ${isActive ? 'active' : ''} ${disabled ? 'disabled': ''}`}
      onClick={() => {
        if (!disabled) onSelectChat(chat.id);
      }}
    >
      <div className="chat-item-main">
        {editing ? (
          <input
            className="chat-item-input"
            value={title}
            onInput={e => setTitle(e.target.value)} // use onInput for Preact
            onBlur={finishEdit}
            onKeyPress={e => e.key === 'Enter' && finishEdit()}
            onClick={e => e.stopPropagation()} // Prevent chat selection when clicking input
            autoFocus
          />
        ) : (
          <span className="chat-item-title" onDblClick={handleDoubleClick} title={chat.title}>{chat.title || "Untitled Chat"}</span>
        )}
        <button
          className="button icon-button chat-item-delete"
          onClick={e => {
            e.stopPropagation();
            if (!disabled) onDeleteChat(chat.id);
          }}
          title="Delete Chat"
          disabled={disabled}
        >
          Del
        </button>
      </div>
      <div className="chat-item-meta">
        {/* Example: chat.messages.length not available if messages fetched separately */}
        {/* {chat.messages.length} messages • */}
        {date} {time}
      </div>
    </div>
  );
}


// Helper function to group chats by date
const groupChatsByDate = (chats) => {
  // ... (groupChatsByDate function remains the same as in your provided patch)
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
    const chatTime = new Date(chat.started).getTime();
    let groupTitle;
    let groupKey;

    if (chatTime >= todayStart) { groupTitle = 'Today'; groupKey = 'today'; }
    else if (chatTime >= yesterdayStart) { groupTitle = 'Yesterday'; groupKey = 'yesterday'; }
    else if (chatTime >= thisWeekStart) { groupTitle = 'This Week'; groupKey = 'this-week'; }
    else if (chatTime >= lastWeekStart) { groupTitle = 'Last Week'; groupKey = 'last-week'; }
    else if (chatTime >= thisMonthStart) { groupTitle = 'This Month'; groupKey = 'this-month'; }
    else {
      const chatDateObj = new Date(chat.started);
      groupTitle = chatDateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
      groupKey = `${chatDateObj.getFullYear()}-${String(chatDateObj.getMonth() + 1).padStart(2, '0')}`;
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
  chats, // This is the flattened list of all loaded chats
  currentChatId,
  onSelectChat,
  onNewChat,
  onTitleUpdate,
  onDeleteChat,
  disabled = false,
  // Props from TanStack Query via ChatList container
  hasMoreChatsToFetch,
  onLoadMoreChats, // This is fetchNextPage from useInfiniteQuery
  isLoadingMoreChats
}) {
  const [collapsed, setCollapsed] = useState(false);

  // `chats` prop is already sorted by created_at descending from the API/useInfiniteQuery
  // So, `sorted` might be redundant if `groupChatsByDate` can handle that order.
  // For safety or if groupChatsByDate expects a specific sort, keep it.
  const sortedAndMappedChats = useMemo(
     () => [...chats].sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime()),
     [chats]
   );

  const groupedItems = useMemo(() => groupChatsByDate(sortedAndMappedChats), [sortedAndMappedChats]);

  const observer = useRef();
  const loadMoreSentinelRef = useCallback(node => {
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreChatsToFetch && !isLoadingMoreChats && !disabled) {
        console.log("Sentinel intersecting, calling onLoadMoreChats");
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
        {!collapsed && (
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
          // item.type === 'chat'
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
        {!collapsed && !isLoadingMoreChats && !hasMoreChatsToFetch && chats.length > 0 && (
            <div className="all-chats-loaded-indicator">All chats loaded.</div>
        )}
        {!collapsed && !isLoadingMoreChats && chats.length === 0 && (
            <div className="no-chats-indicator">No chats yet.</div>
        )}
      </div>
    </div>
  );
}
