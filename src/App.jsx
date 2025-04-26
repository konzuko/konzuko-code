import { useState, useEffect }      from 'preact/hooks'
import ChatPane                     from './chatpane.jsx'
import {
  callApiForText,
  fetchChats,
  fetchMessages,
  createChat,
  createMessage,
  updateMessage,
  archiveMessagesAfter
} from './api.js'

import {
  useSettings,
  useFormData,
  useMode,
  useTokenCount
} from './hooks.js'

function App () {
  /*────────────────────────── State */
  const [chats, setChats]           = useState([])
  const [currentChatId, setCurrent] = useState(null)
  const [loadingChats, setLC]       = useState(true)
  const [loadingSend, setLS]        = useState(false)
  const [editingId,  setEditing]    = useState(null)

  const [settings, setSettings]     = useSettings()
  const [form,     setForm]         = useFormData()
  const [mode,     setMode]         = useMode()

  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  )

  /*────────────────────────── Initial load */
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLC(true)
      try {
        let rows   = await fetchChats()
        let shaped = rows.map(r => ({
          id      : r.id,
          title   : r.title,
          started : r.created_at,
          model   : r.code_type,
          messages: []
        }))

        if (!shaped.length) {
          const c = await createChat({ title: 'New Chat', model: settings.codeType })
          shaped  = [{ id: c.id, title: c.title, started: c.created_at, model: c.code_type, messages: [] }]
        }

        if (alive) {
          setChats(shaped)
          setCurrent(shaped[0].id)
        }
      } catch (err) {
        alert('Failed to load chats: ' + err.message)
      } finally {
        alive && setLC(false)
      }
    })()
    return () => { alive = false }
  }, [settings.codeType])

  /*────────────────────────── Get messages on chat-switch */
  useEffect(() => {
    if (!currentChatId) return
    let alive = true
    fetchMessages(currentChatId)
      .then(msgs => {
        if (!alive) return
        setChats(cs => cs.map(c => c.id === currentChatId ? { ...c, messages: msgs } : c))
      })
      .catch(err => alert('Failed to fetch messages: ' + err.message))
    return () => { alive = false }
  }, [currentChatId])

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] }

  /*────────────────────────── Utilities */
  const buildUserPrompt = () => {
    if (mode === 'DEVELOP') {
      return `
MODE: DEVELOP
GOAL: ${form.developGoal}
FEATURES: ${form.developFeatures}
RETURN FORMAT: ${form.developReturnFormat}
WARNINGS: ${form.developWarnings}
CONTEXT: ${form.developContext}`.trim()
    }
    if (mode === 'COMMIT')   return 'MODE: COMMIT\nPlease generate a git-style commit message.'
    if (mode === 'DIAGNOSE') return 'MODE: DIAGNOSE\nPlease analyze any errors or pitfalls.'
    return ''
  }

  /*────────────────────────── Handlers */
  async function handleNewChat () {
    setLS(true)
    try {
      const c = await createChat({ title: 'New Chat', model: settings.codeType })
      setChats(cs => [{ id: c.id, title: c.title, started: c.created_at, model: c.code_type, messages: [] }, ...cs])
      setCurrent(c.id)
    } catch (err) {
      alert('Failed to create chat: ' + err.message)
    } finally { setLS(false) }
  }

  async function handleSend () {
    if (!currentChatId) return
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      alert('GOAL is required for DEVELOP mode.')
      return
    }

    setLS(true)
    try {
      const prompt = buildUserPrompt()
      let   msgs   = currentChat.messages

      if (editingId) {
        await updateMessage(editingId, prompt)
        await archiveMessagesAfter(currentChatId, editingId)
        setEditing(null)
        msgs = await fetchMessages(currentChatId)      // only ONE re-fetch
      } else {
        const newMsg = await createMessage({
          chat_id: currentChatId,
          role   : 'user',
          content: [{ type: 'text', text: prompt }]
        })
        msgs = [...msgs, newMsg]
      }

      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      })

      const assistant = await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: error ? `Error: ${error}` : content
      })

      setChats(cs => cs.map(c => c.id === currentChatId
        ? { ...c, messages: [...msgs, assistant] }
        : c
      ))

      if (!editingId) {
        setForm({
          developGoal: '', developFeatures: '', developReturnFormat: '',
          developWarnings: '', developContext: '', fixCode: '', fixErrors: ''
        })
      }
    } catch (err) {
      alert('Send failed: ' + err.message)
    } finally { setLS(false) }
  }

  function handleEdit (msg) {
    setEditing(msg.id)
    const txt = Array.isArray(msg.content)
      ? msg.content.map(c => c.type === 'text' ? c.text : '').join('')
      : String(msg.content)
    setForm(f => ({ ...f, developGoal: txt }))
  }

  function handleCopyAll () {
    const txt = currentChat.messages
      .map(m => `${m.role.toUpperCase()}: ${
        Array.isArray(m.content)
          ? m.content.map(c => c.type === 'text' ? c.text : '[img]').join('')
          : m.content
      }`).join('\n\n')
    navigator.clipboard.writeText(txt)
  }

  /*────────────────────────── Render */
  if (loadingChats) {
    return <h2 style={{ textAlign: 'center', marginTop: '20vh' }}>Loading…</h2>
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={setCurrent}
        onDeleteChat={id => setChats(cs => cs.filter(c => c.id !== id))}
      />

      {/* Main column */}
      <div className="main-content">
        {/* Top bar */}
        <div className="top-bar">
          <button className="button" onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}>
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>konzuko-code</span>
          <select
            value={settings.codeType}
            onChange={e => setSettings({ ...settings, codeType: e.target.value })}
            style={{ marginRight: '1em' }}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="hugo">Hugo</option>
            <option value="go">Go</option>
          </select>
          <div style={{ marginLeft: 'auto', padding: '4px 12px',
                        background: '#4f8eff', borderRadius: 4 }}>
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {/* Settings drawer */}
        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e => setSettings({ ...settings, apiKey: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e => setSettings({ ...settings, model: e.target.value })}
              >
                <option>gpt-4o</option>
                <option>gpt-3.5-turbo</option>
                <option>o3-2025-04-16</option>
              </select>
            </div>
          </div>
        )}

        {/* Split view – messages | template */}
        <div className="content-container">
          {/* Conversation */}
          <div className="chat-container">
            {currentChat.messages.map((m, i) => (
              <div key={i} className={`message message-${m.role}`}>
                <div className="message-header">
                  <span className="message-role">{m.role}</span>
                  <div className="message-actions">
                    <button
                      className="button icon-button"
                      onClick={() => navigator.clipboard.writeText(
                        Array.isArray(m.content)
                          ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
                          : m.content
                      )}
                    >Copy</button>
                    {m.role === 'user' && (
                      <button
                        className="button icon-button"
                        onClick={() => handleEdit(m)}
                      >Edit</button>
                    )}
                  </div>
                </div>
                <div className="message-content">
                  {Array.isArray(m.content)
                    ? m.content.map((c, j) => c.type === 'text'
                        ? <div key={j} style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                        : <img key={j} src={c.image_url.url} style={{ maxWidth: 200 }} />)
                    : <div>{m.content}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Prompt builder */}
          <div className="template-container">
            {/* Mode buttons */}
            <div className="template-buttons">
              {['DEVELOP','COMMIT','DIAGNOSE'].map(m => (
                <button
                  key={m}
                  className={`button ${mode === m ? 'active' : ''}`}
                  onClick={() => { setMode(m); setEditing(null) }}
                >{m}</button>
              ))}
            </div>

            {/* DEVELOP fields */}
            {mode === 'DEVELOP' && (
              <>
                {[
                  ['GOAL',   'developGoal',        2],
                  ['FEATURES','developFeatures',   2],
                  ['RETURN FORMAT','developReturnFormat',2],
                  ['WARNINGS','developWarnings',   2],
                  ['CONTEXT','developContext',     3]
                ].map(([label, key, rows]) => (
                  <div key={key} className="form-group">
                    <label>{label}:</label>
                    <textarea
                      rows={rows}
                      className="form-textarea"
                      value={form[key]}
                      onInput={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </>
            )}

            {/* Send */}
            <button
              className="button send-button"
              disabled={loadingSend}
              onClick={handleSend}
            >
              {loadingSend
                ? 'Working…'
                : editingId ? 'Update & Resend' : 'Send Prompt'}
            </button>

            <div className="action-row">
              <button className="button" onClick={handleCopyAll}>Copy Everything</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App