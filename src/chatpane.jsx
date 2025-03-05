import { useState } from 'preact/hooks';

function ChatPane({ chats, currentChatId, onSelectChat, onNewChat }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="flex space-between align-center" style={{ padding: 'var(--space-sm)' }}>
        <button className="button icon-button" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '>' : '<'}
        </button>
        {!collapsed && <button className="button" onClick={onNewChat}>New Chat</button>}
      </div>
      {!collapsed &&
        chats.map(chat => {
          const { id, title, started, messages } = chat;
          const isActive = id === currentChatId;
          const startedDate = new Date(started);
          const dateString = startedDate.toISOString().split('T')[0];
          const timeString = startedDate.toISOString().split('T')[1]?.slice(0, 5);
          return (
            <div 
              key={id} 
              className={`chat-item ${isActive ? 'active' : ''}`} 
              onClick={() => onSelectChat(id)}
            >
              <div style={{ fontWeight: 'bold' }}>{title}</div>
              <div style={{ fontSize: 'smaller', color: 'var(--text-secondary)' }}>
                {messages.length} messages • {dateString} {timeString}
              </div>
            </div>
          );
        })}
    </div>
  );
}

export default ChatPane;
