import { useState, useMemo } from 'preact/hooks';

function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat }) {
const [editing, setEditing] = useState(false);
const [title, setTitle] = useState(chat.title);

const startedDate = new Date(chat.started);
const dateString = startedDate.toISOString().split('T')[0];
const timeString = startedDate.toISOString().split('T')[1]?.slice(0, 5);

const handleDoubleClick = (e) => {
e.stopPropagation();
setEditing(true);
};

const handleBlur = () => {
setEditing(false);
onTitleUpdate(chat.id, title);
};

const handleKeyPress = (e) => {
if (e.key === 'Enter') {
setEditing(false);
onTitleUpdate(chat.id, title);
}
};

const handleDeleteChatClick = (e) => {
e.stopPropagation();
onDeleteChat(chat.id);
};

return (
<div
/* Note the single set of backticks around the whole string: */
className={`chat-item ${isActive ? 'active' : ''}`}
onClick={() => onSelectChat(chat.id)}
>
<div style={{ fontWeight: 'bold' }}>
{editing ? (
<input
value={title}
onChange={(e) => setTitle(e.target.value)}
onBlur={handleBlur}
onKeyPress={handleKeyPress}
autoFocus
/>
) : (
<span onDoubleClick={handleDoubleClick}>{chat.title}</span>
)}
<button
       className="button icon-button"
       onClick={handleDeleteChatClick}
       title="Delete Chat"
     >
Del
</button>
</div>
<div style={{ fontSize: 'smaller', color: 'var(--text-secondary)' }}>
{chat.messages.length} messages • {dateString} {timeString}
</div>
</div>
);
}

function ChatPane({ chats, currentChatId, onSelectChat, onNewChat, onTitleUpdate, onDeleteChat }) {
const [collapsed, setCollapsed] = useState(false);

const sortedChats = useMemo(() => {
return [...chats].sort((a, b) => new Date(b.started) - new Date(a.started));
}, [chats]);

return (
/* Again, one set of backticks for the entire string: */
<div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
<div className="flex space-between align-center" style={{ padding: 'var(--space-sm)' }}>
<button className="button icon-button" onClick={() => setCollapsed(!collapsed)}>
{collapsed ? '>' : '<'}
</button>
{!collapsed && <button className="button" onClick={onNewChat}>New Chat</button>}
</div>

  {!collapsed &&
    sortedChats.map(chat => {
      const isActive = chat.id === currentChatId;
      return (
        <ChatItem
          key={chat.id}
          chat={chat}
          isActive={isActive}
          onSelectChat={onSelectChat}
          onTitleUpdate={onTitleUpdate}
          onDeleteChat={onDeleteChat}
        />
      );
    })}
</div>
);
}