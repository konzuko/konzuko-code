
import { useState, useEffect, useRef } from 'preact/hooks'
import ChatPane from './chatpane.jsx'
import {
  callApiForText,
  fetchChats,
  fetchMessages,
  createChat,
  createMessage
} from './api.js'
import {
  useSettings,
  useFormData,
  useDroppedFiles,
  useMode,
  approximateTokenCount
} from './hooks.js'

// Return-format fallback
const DEFAULT_RETURN_FORMAT =
  "return complete refactored code in FULL so that i can paste it directly into my ide"

// Helper to convert File -> base64 data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = err => reject(err)
    reader.readAsDataURL(file)
  })
}

function App() {
  const [chats, setChats] = useState([])
  const [currentChatId, setCurrentChatId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingChats, setLoadingChats] = useState(true) // used to block while fetching chats
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const [settings, setSettings] = useSettings()
  const [formData, setFormData] = useFormData()
  const [droppedFiles, setDroppedFiles] = useDroppedFiles()
  const [mode, setMode] = useMode()
  const [hasEditedReturnFormat, setHasEditedReturnFormat] = useState(false)
  const [uploadedImages, setUploadedImages] = useState([])

  const fileInputRef = useRef()

  // On mount, fetch Supabase chats and shape them to mirror the old local version
  useEffect(() => {
    async function load() {
      setLoadingChats(true)
      try {
        // your fetch from supabase
        const rows = await fetchChats()
        // shape them to your old format: {id, title, started, model, messages: []}
        const shaped = rows.map(r => ({
          id: r.id,
          title: r.title,
          started: r.created_at,   // old code calls it .started
          model: r.code_type,      // old code calls it .model
          messages: []
        }))
        if (shaped.length) {
          setChats(shaped)
          setCurrentChatId(shaped[0].id)
        } else {
          // If no chats exist, create one automatically
          const c = await createChat({ title: 'New Chat', model: settings.model })
          const newChat = {
            id: c.id,
            title: c.title,
            started: c.created_at,
            model: c.code_type,
            messages: []
          }
          setChats([newChat])
          setCurrentChatId(newChat.id)
        }
      } finally {
        setLoadingChats(false)
      }
    }
    load()
  }, [settings.model])

  // Whenever currentChatId changes, fetch the messages from Supabase
  useEffect(() => {
    if (!currentChatId) return
    fetchMessages(currentChatId).then(msgs => {
      setChats(prev =>
        prev.map(c =>
          c.id === currentChatId ? {...c, messages: msgs} : c
        )
      )
    })
  }, [currentChatId])

  // Renders a message’s content array or string
  function renderMessageContent(content) {
    if (typeof content === 'string') {
      return <div>{content}</div>
    }
    if (Array.isArray(content)) {
      return content.map((item, i) => {
        if (item.type === 'text') {
          return (
            <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {item.text}
            </div>
          )
        } else if (item.type === 'image_url') {
          // image
          return (
            <div key={i} style={{ margin: '0.5em 0' }}>
              <img
                src={item.image_url.url}
                alt="Uploaded"
                style={{ maxWidth: '300px', maxHeight: '300px' }}
              />
            </div>
          )
        } else {
          // fallback for unknown item
          return <div key={i}>{JSON.stringify(item)}</div>
        }
      })
    }
    // fallback if content is an object or something
    return <div>{JSON.stringify(content, null, 2)}</div>
  }

  // Assist with copying content to the clipboard as plain text
  function getMessagePlainText(content) {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      return content
        .map(item => item.type === 'text' ? item.text : '[Image]')
        .join('\n')
    }
    return JSON.stringify(content)
  }

  // Create a new, empty chat in Supabase, then push it into local chat state
  async function handleNewChat() {
    setLoading(true)
    try {
      const nc = await createChat({ title: 'New Chat', model: settings.model })
      const shaped = {
        id: nc.id,
        title: nc.title,
        started: nc.created_at,
        model: nc.code_type,
        messages: []
      }
      setChats(prev => [shaped, ...prev])
      setCurrentChatId(nc.id)
    } finally {
      setLoading(false)
    }
  }

  // When picking a chat from the sidebar
  function handleSelectChat(id) {
    setCurrentChatId(id)
  }

  // If you want to truly delete from the DB, do a Supabase delete call here.
  async function handleDeleteChat(id) {
    // remove locally:
    setChats(prev => prev.filter(c => c.id !== id))
    if (id === currentChatId) {
      setCurrentChatId(null)
    }
    // you could also call supabase to remove the chat row + messages if needed
    // e.g. supabase.from('chats').delete().eq('id', id)
  }

  // Let the user rename chat titles. You can also persist that to Supabase if you want.
  function handleTitleUpdate(chatId, newTitle) {
    setChats(prevChats =>
      prevChats.map(c =>
        c.id === chatId ? { ...c, title: newTitle } : c
      )
    )
    // optionally, call supabase to update the chat row:
    // await supabase.from('chats').update({ title: newTitle }).eq('id', chatId)
  }

  // Drag-n-drop helpers
  function isTextFile(file) {
    return (
      file.type.startsWith('text/') ||
      /\.(txt|js|jsx|ts|tsx|py|json|html|css|md)$/i.test(file.name)
    )
  }

  function handleTextareaDrop(fieldName, e) {
    e.preventDefault()
    e.stopPropagation()
    const files = [...e.dataTransfer.files]
    for (const file of files) {
      if (isTextFile(file)) {
        file.text().then(txt => {
          setFormData(prev => ({
            ...prev,
            [fieldName]: prev[fieldName] + `\n/* ${file.name} */\n` + txt
          }))
          setDroppedFiles(prev => ({
            ...prev,
            [fieldName]: [...(prev[fieldName] || []), file.name]
          }))
        })
      }
    }
  }

  // For images
  function handleFileSelection(e) {
    const files = [...e.target.files]
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        readFileAsDataURL(file).then(url => {
          setUploadedImages(prev => [...prev, { dataUrl: url, name: file.name }])
        })
      }
    }
  }

  function removeUploadedImage(idx) {
    setUploadedImages(prev => {
      const copy = [...prev]
      copy.splice(idx, 1)
      return copy
    })
  }

  // The main “Send Prompt” logic
  async function handleSendPrompt() {
    if (!currentChatId) return
    const chat = chats.find(c => c.id === currentChatId)
    if (!chat) return

    // If user is in REVERT mode
    if (mode === 'REVERT') {
      if (!confirmRevert) {
        setConfirmRevert(true)
        return
      } else {
        // actually revert last message
        setConfirmRevert(false)
        // You might want to remove from DB as well:
        // e.g. get the last message, supabase.from('messages').delete().eq('id', lastMsg.id)
        return
      }
    }

    // Build the content for the user’s message
    let userContent = ''
    if (mode === 'DEVELOP') {
      const rf = hasEditedReturnFormat
        ? formData.developReturnFormat
        : DEFAULT_RETURN_FORMAT
      userContent = `
MODE: DEVELOP
GOAL: ${formData.developGoal}
FEATURES: ${formData.developFeatures}
RETURN FORMAT: ${rf}
THINGS TO REMEMBER/WARNINGS: ${formData.developWarnings}
CONTEXT: ${formData.developContext}
      `.trim()

      if (!formData.developGoal.trim()) {
        alert('GOAL is required for DEVELOP mode.')
        return
      }
    } else if (mode === 'FIX') {
      userContent = `
MODE: FIX
FIX YOUR CODE: ${formData.fixCode}
ANY ERRORS?: ${formData.fixErrors}
      `.trim()
    }

    if (!userContent) {
      // no text? If no images either, do nothing
      if (uploadedImages.length === 0) return
    }

    // Combine text + images
    const msgParts = []
    if (userContent) {
      msgParts.push({ type: 'text', text: userContent })
    }
    if (uploadedImages.length) {
      uploadedImages.forEach(img => {
        msgParts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
      })
      setUploadedImages([])
    }

    setLoading(true)
    try {
      // Create user message in DB
      await createMessage({
        chat_id: chat.id,
        role: 'user',
        content: msgParts
      })
      // Call API
      const result = await callApiForText({
        messages: [...(chat.messages || []), { role: 'user', content: msgParts }],
        apiKey: settings.apiKey,
        model: settings.model
      })
      const assistantReply = result.error ? `Error: ${result.error}` : result.content || ''
      // Insert assistant message in DB
      await createMessage({
        chat_id: chat.id,
        role: 'assistant',
        content: assistantReply
      })
      // Refetch updated messages
      const updated = await fetchMessages(chat.id)
      setChats(prev =>
        prev.map(c => (c.id === chat.id ? { ...c, messages: updated } : c))
      )
    } finally {
      setLoading(false)
    }

    // Clear after send
    if (mode === 'DEVELOP') {
      setFormData(prev => ({
        ...prev,
        developGoal: '',
        developFeatures: '',
        developReturnFormat: '',
        developWarnings: '',
        developContext: ''
      }))
      setHasEditedReturnFormat(false)
    } else if (mode === 'FIX') {
      setFormData(prev => ({
        ...prev,
        fixCode: '',
        fixErrors: ''
      }))
    }
    setConfirmRevert(false)
  }

  // Count tokens for the current chat
  const currentChatObj = chats.find(c => c.id === currentChatId)
  const tokenCount = currentChatObj
    ? currentChatObj.messages.reduce((acc, m) => {
        if (typeof m.content === 'string') return acc + approximateTokenCount(m.content)
        // if m.content is array:
        if (Array.isArray(m.content)) {
          let joined = m.content.map(x => x.type === 'text' ? x.text : '').join('')
          return acc + approximateTokenCount(joined)
        }
        return acc
      }, 0)
    : 0

  // If we’re still waiting for initial chat load, show a minimal placeholder
  // but continue to render the sidebar so user can see "New Chat" button, etc.
  // You can tweak how you want the UI experience to be.
  if (loadingChats && !chats.length) {
    return <h2 style={{ textAlign: 'center', marginTop: '20vh' }}>Loading Chat…</h2>
  }

  return (
    <div className="app-container">
      {/* Confirm Revert dialog */}
      {confirmRevert && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Confirm Revert</h3>
            <p>Click SEND again to revert the last message.</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setConfirmRevert(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Your sidebar chat list */}
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onTitleUpdate={handleTitleUpdate}
      />

      <div className="main-content">
        <div className="top-bar">
          <button
            onClick={() => setShowSettings(s => !s)}
            className="button"
          >
            {showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ marginLeft: '1em', fontWeight: 'bold' }}>
            konzuko-code
          </span>

          <div
            className="token-usage"
            style={{
              marginLeft: '1em',
              backgroundColor: '#000',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: '4px'
            }}
          >
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {/* Optional settings panel */}
        {showSettings && (
          <div style={{ border: '1px solid var(--border)', margin: '1em', padding: '1em', borderRadius: '4px' }}>
            {/* Example: your key & model config… */}
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                type="text"
                value={settings.apiKey}
                onInput={e => setSettings({...settings, apiKey: e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e => setSettings({...settings, model: e.target.value})}
              >
                <option value="o4-mini-2025-04-16">o4-mini-2025-04-16</option>
                <option value="o1">o1 (slower, more reasoning)</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27</option>
              </select>
            </div>
          </div>
        )}

        {/* The main chat message list */}
        <div className="chat-container">
          {currentChatObj && currentChatObj.messages && currentChatObj.messages.map((m, idx) => (
            <div key={idx} className={`message message-${m.role}`}>
              <div className="message-header">
                <span className="message-role">{m.role}</span>
                <div className="message-actions">
                  <button
                    className="button icon-button"
                    onClick={() => navigator.clipboard.writeText(getMessagePlainText(m.content))}
                  >
                    Copy
                  </button>
                  {m.role === 'user' && (
                    <button
                      className="button icon-button"
                      disabled={loading || idx < currentChatObj.messages.length - 1}
                      onClick={() => handleSendPrompt()}
                    >
                      Resend
                    </button>
                  )}
                  <button className="button icon-button" onClick={() => { /* delete message if you want */ }}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="message-content">
                {renderMessageContent(m.content)}
              </div>
            </div>
          ))}
        </div>

        {/* Your big “template” area with DEVELOP/FIX/REVERT */}
        <div className="template-container">
          <div className="template-content" onDragOver={e => e.preventDefault()}>
            <div className="flex gap-sm mb-md">
              <button
                className={`button ${mode === 'DEVELOP' ? 'active' : ''}`}
                onClick={() => { setMode('DEVELOP'); setConfirmRevert(false) }}
              >
                DEVELOP
              </button>
              <button
                className={`button ${mode === 'FIX' ? 'active' : ''}`}
                onClick={() => { setMode('FIX'); setConfirmRevert(false) }}
              >
                FIX
              </button>
              <button
                className={`button ${mode === 'REVERT' ? 'active' : ''}`}
                onClick={() => setMode('REVERT')}
              >
                REVERT
              </button>
            </div>

            {mode === 'DEVELOP' && (
              <div className="flex flex-column">
                <div className="form-group">
                  <label>GOAL:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developGoal}
                    onInput={e => setFormData({...formData, developGoal: e.target.value})}
                    onDrop={e => handleTextareaDrop('developGoal', e)}
                  />
                </div>
                <div className="form-group">
                  <label>List every FEATURE of the program:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developFeatures}
                    onInput={e => setFormData({...formData, developFeatures: e.target.value})}
                    onDrop={e => handleTextareaDrop('developFeatures', e)}
                  />
                </div>
                <div className="form-group">
                  <label>RETURN FORMAT:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder={DEFAULT_RETURN_FORMAT}
                    value={hasEditedReturnFormat ? formData.developReturnFormat : DEFAULT_RETURN_FORMAT}
                    onInput={e => {
                      setFormData({...formData, developReturnFormat: e.target.value})
                      setHasEditedReturnFormat(true)
                    }}
                    onDrop={e => handleTextareaDrop('developReturnFormat', e)}
                  />
                </div>
                <div className="form-group">
                  <label>THINGS TO REMEMBER/WARNINGS:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developWarnings}
                    onInput={e => setFormData({...formData, developWarnings: e.target.value})}
                    onDrop={e => handleTextareaDrop('developWarnings', e)}
                  />
                </div>
                <div className="form-group">
                  <label>CONTEXT:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developContext}
                    onInput={e => setFormData({...formData, developContext: e.target.value})}
                    onDrop={e => handleTextareaDrop('developContext', e)}
                  />
                </div>
              </div>
            )}
            {mode === 'FIX' && (
              <div className="flex flex-column">
                <div className="form-group">
                  <label>FIX YOUR CODE:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.fixCode}
                    onInput={e => setFormData({...formData, fixCode: e.target.value})}
                    onDrop={e => handleTextareaDrop('fixCode', e)}
                  />
                </div>
                <div className="form-group">
                  <label>ANY ERRORS?:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.fixErrors}
                    onInput={e => setFormData({...formData, fixErrors: e.target.value})}
                    onDrop={e => handleTextareaDrop('fixErrors', e)}
                  />
                </div>
              </div>
            )}
            {mode === 'REVERT' && (
              <div className="mb-md">
                {confirmRevert
                  ? <div style={{ color: 'var(--error)' }}>Click SEND again to revert the last message.</div>
                  : <div>Click SEND to confirm revert (removing last message).</div>
                }
              </div>
            )}

            {/* If images are queued, show them */}
            {uploadedImages.length > 0 && (
              <div className="image-preview-container mb-md">
                <div className="image-preview-header">Images to upload:</div>
                <div className="image-preview-grid">
                  {uploadedImages.map((img, i) => (
                    <div key={i} className="image-preview-item">
                      <img src={img.dataUrl} alt={img.name} />
                      <button
                        className="image-remove-button"
                        onClick={() => removeUploadedImage(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Select or Drag/Drop Images:</label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelection}
              />
            </div>

            <button
              className="button send-button mt-sm"
              onClick={handleSendPrompt}
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Send Prompt'}
            </button>
          </div>
          <div className="expand-handle" title="Resize template section">
            <div className="handle-line"></div>
            <span className="handle-text">Resize</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
