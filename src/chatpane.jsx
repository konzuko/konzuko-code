import { useState, useMemo } from 'preact/hooks'

function ChatItem({ chat, isActive, onSelectChat, onTitleUpdate, onDeleteChat }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle]     = useState(chat.title)

  /* local-tz date */
  const started = new Date(chat.started).toLocaleString()

  const handleDoubleClick = (e) => { e.stopPropagation(); setEditing(true) }
  const finishEdit = () => { setEditing(false); onTitleUpdate(chat.id, title) }

  return (
    <div
      className={`chat-item ${isActive ? 'active' : ''}`}
      onClick={() => onSelectChat(chat.id)}
    >
      <div style={{ fontWeight:'bold' }}>
        {editing ? (
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={finishEdit}
            onKeyPress={e => e.key==='Enter' && finishEdit()}
            autoFocus
          />
        ) : (
          <span onDoubleClick={handleDoubleClick}>{chat.title}</span>
        )}
        <button
          className="button icon-button"
          onClick={e => { e.stopPropagation(); onDeleteChat(chat.id) }}
          title="Delete Chat"
        >
          Del
        </button>
      </div>
      <div style={{ fontSize:'smaller', color:'var(--text-secondary)' }}>
        {chat.messages.length} messages • {started}
      </div>
    </div>
  )
}

function ChatPane({ chats, currentChatId, onSelectChat,
                    onNewChat, onTitleUpdate, onDeleteChat }) {
  const [collapsed, setCollapsed] = useState(false)
  const sortedChats = useMemo(
    () => [...chats].sort((a,b) => new Date(b.started) - new Date(a.started)),
    [chats]
  )

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="flex space-between align-center" style={{ padding:'var(--space-sm)' }}>
        <button className="button icon-button" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '>' : '<'}
        </button>
        {!collapsed && <button className="button" onClick={onNewChat}>New Chat</button>}
      </div>

      {!collapsed && sortedChats.map(chat =>
        <ChatItem
          key={chat.id}
          chat={chat}
          isActive={chat.id === currentChatId}
          onSelectChat={onSelectChat}
          onTitleUpdate={onTitleUpdate}
          onDeleteChat={onDeleteChat}
        />
      )}
    </div>
  )
}

export default ChatPane