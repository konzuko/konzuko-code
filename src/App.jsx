/* -------------------------------------------------------------------------
   src/App.jsx
   Main UI – message ordering + auto-select next chat on delete
---------------------------------------------------------------------------*/
import { useState, useEffect } from 'preact/hooks'
import ChatPane                from './chatpane.jsx'
import {
  callApiForText,
  fetchChats,          fetchMessages,
  createChat,          createMessage,
  updateMessage,       archiveMessagesAfter,
  deleteMessage,       undoDeleteMessage,
  deleteChat,          undoDeleteChat
} from './api.js'
import {
  useSettings,
  useFormData,
  useMode,
  useTokenCount
} from './hooks.js'

/* render markdown-like code fences with copy buttons */
function renderRichText (text) {
  if (!text.includes('```')) {
    return <div style={{ whiteSpace:'pre-wrap' }}>{text}</div>
  }
  const parts = text.split(/```/g)
  return parts.map((chunk, i) =>
    i % 2 === 1
      ? (
        <div key={i} className="code-wrapper">
          <button
            className="copy-snippet"
            onClick={() => navigator.clipboard.writeText(chunk)}
          >
            Copy
          </button>
          <pre className="code-block"><code>{chunk}</code></pre>
        </div>
      )
      : <span key={i}>{chunk}</span>
  )
}

/* toast – auto-dismiss in 30s + optional Undo */
function Toast ({ text, onUndo, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 30000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="toast">
      <span>{text}</span>
      {onUndo && <button className="button" onClick={onUndo}>Undo</button>}
      <button className="button icon-button" onClick={onClose}>✕</button>
    </div>
  )
}

export default function App () {
  /* ── state ─────────────────────────────────────────────────────────*/
  const [chats, setChats]           = useState([])
  const [currentChatId, setCurrent] = useState(null)
  const [loadingChats, setLC]       = useState(true)
  const [loadingSend, setLS]        = useState(false)
  const [editingId, setEditing]     = useState(null)
  const [toast, setToast]           = useState(null)   // { text, onUndo }

  const [settings, setSettings] = useSettings()
  const [form, setForm]         = useFormData()
  const [mode, setMode]         = useMode()

  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  )

  const showToast = (text, onUndo) => setToast({ text, onUndo })

  /* fetch chat list */
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLC(true)
      try {
        const rows = await fetchChats()
        let shaped = rows.map(r => ({
          id     : r.id,
          title  : r.title,
          started: r.created_at,
          model  : r.code_type,
          messages: []
        }))
        if (!shaped.length) {
          const c = await createChat({ title:'New Chat', model:settings.codeType })
          shaped = [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }]
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

  /* fetch messages */
  useEffect(() => {
    if (!currentChatId) return
    let alive = true
    fetchMessages(currentChatId)
      .then(msgs => alive && setChats(cs =>
        cs.map(c => c.id === currentChatId ? { ...c, messages: msgs } : c)
      ))
      .catch(err => alert('Failed to fetch messages: ' + err.message))
    return () => { alive = false }
  }, [currentChatId])

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] }

  /* build the OpenAI prompt */
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

  const scrollTo = idx =>
    document.getElementById(`msg-${idx}`)?.scrollIntoView({ behavior:'smooth', block:'center' })

  const resetForm = () => setForm({
    developGoal:'', developFeatures:'', developReturnFormat:'',
    developWarnings:'', developContext:'',
    fixCode:'', fixErrors:''
  })

  /* create new chat */
  async function handleNewChat () {
    setLS(true)
    try {
      const c = await createChat({ title:'New Chat', model:settings.codeType })
      setChats(cs => [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }, ...cs])
      setCurrent(c.id)
    } catch (err) {
      alert('Failed to create chat: ' + err.message)
    } finally {
      setLS(false)
    }
  }

  /* send prompt & receive assistant response */
  async function handleSend () {
    if (!currentChatId) return
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      alert('GOAL is required for DEVELOP mode.')
      return
    }
    setLS(true)
    try {
      const prompt = buildUserPrompt()
      let msgs     = currentChat.messages

      if (editingId) {
        await updateMessage(editingId, prompt)
        await archiveMessagesAfter(currentChatId, editingId)
        setEditing(null)
        msgs = await fetchMessages(currentChatId)  // re-fetch
      } else {
        const newMsg = await createMessage({
          chat_id: currentChatId,
          role   : 'user',
          content: [{ type:'text', text:prompt }]
        })
        msgs = [...msgs, newMsg]
      }

      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      })

      const assistantMsg = await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: error ? `Error: ${error}` : content
      })

      setChats(cs => cs.map(c => 
        c.id === currentChatId ? { ...c, messages:[...msgs, assistantMsg] } : c
      ))

      if (!editingId) resetForm()
    } catch (err) {
      alert('Send failed: ' + err.message)
    } finally {
      setLS(false)
    }
  }

  /* delete a single message (soft) with undo */
  async function handleDeleteMessage (id) {
    if (!confirm('Delete this message? You can undo for ~30 min.')) return
    try {
      await deleteMessage(id)
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages:c.messages.filter(m => m.id !== id) } : c
      ))
      showToast(
        'Message deleted.',
        () => undoDeleteMessage(id)
              .then(() => fetchMessages(currentChatId))
              .then(msgs => setChats(cs => cs.map(c =>
                c.id === currentChatId ? { ...c, messages:msgs } : c
              )))
              .catch(e => alert('Undo failed: '+e.message))
              .finally(() => setToast(null))
      )
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  /* delete an entire chat (soft) with undo + auto-select next */
  async function handleDeleteChatUI (id) {
    if (!confirm('Delete this entire chat? You can undo for ~30 min.')) return
    try {
      await deleteChat(id)
      setChats(cs => {
        const filtered = cs.filter(c => c.id !== id)
        // if we deleted the active chat, pick the next one
        if (currentChatId === id) {
          setCurrent(filtered[0]?.id ?? null)
        }
        return filtered
      })
      showToast(
        'Chat deleted.',
        () => undoDeleteChat(id)
              .then(() => fetchChats())
              .then(rows => {
                const shaped = rows.map(r => ({
                  id:r.id, title:r.title,
                  started:r.created_at,
                  model:r.code_type,
                  messages:[]
                }))
                setChats(shaped)
                setCurrent(shaped[0]?.id ?? null)
              })
              .catch(e => alert('Undo failed: '+e.message))
              .finally(() => setToast(null))
      )
    } catch (err) {
      alert('Delete failed: ' + err.message)
    }
  }

  /* copy entire conversation to clipboard */
  function handleCopyAll () {
    const txt = currentChat.messages
      .map(m => `${m.role.toUpperCase()}: ${
        Array.isArray(m.content)
          ? m.content.map(c => c.type==='text'?c.text:'').join('')
          : m.content
      }`).join('\n\n')
    navigator.clipboard.writeText(txt)
  }

  /* render */
  if (loadingChats) {
    return <h2 style={{ textAlign:'center', marginTop:'20vh' }}>Loading…</h2>
  }

  return (
    <div className="app-container">
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={setCurrent}
        onDeleteChat={handleDeleteChatUI}
      />

       {/* ── main content column ───────────────────────────────────*/}
       <div className="main-content">
        {/* top-bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>

          <span style={{ margin:'0 1em', fontWeight:'bold' }}>konzuko-code</span>

          <select
            value={settings.codeType}
            onChange={e => setSettings({ ...settings, codeType:e.target.value })}
            style={{ marginRight:'1em' }}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="hugo">Hugo</option>
            <option value="go">Go</option>
          </select>

          <div style={{
            marginLeft:'auto', padding:'4px 12px',
            background:'#4f8eff', borderRadius:4
          }}>
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {/* settings drawer */}
        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e => setSettings({ ...settings, apiKey:e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e => setSettings({ ...settings, model:e.target.value })}
              >
                <option>gpt-4o</option>
                <option>gpt-3.5-turbo</option>
                <option>o3-2025-04-16</option>
              </select>
            </div>
          </div>
        )}

        {/* split: left chat / right prompt builder */}
        <div className="content-container">
          {/* ───────── conversation list ───────────────────────*/}
          <div className="chat-container">
            {(() => {
              let assistantCounter = 0
              return currentChat.messages.map((m, idx) => {
                const isAssistant = m.role === 'assistant'
                const num         = isAssistant ? ++assistantCounter : null
                const upIdx   = idx>0 ? idx-1 : null
                const downIdx = idx<currentChat.messages.length-1 ? idx+1 : null

                const copyFull = () => navigator.clipboard.writeText(
                  Array.isArray(m.content)
                    ? m.content.map(c => c.type==='text'?c.text:'').join('')
                    : m.content
                )

                return (
                  <div key={idx} id={`msg-${idx}`} className={`message message-${m.role}`}>
                    {isAssistant && (
                      <div className="floating-controls">
                        <button className="button icon-button" onClick={copyFull} title="Copy">📋</button>
                        <button className="button icon-button" onClick={() => scrollTo(upIdx)}   disabled={upIdx==null}>▲</button>
                        <button className="button icon-button" onClick={() => scrollTo(downIdx)} disabled={downIdx==null}>▼</button>
                      </div>
                    )}

                    <div className="message-header">
                      <span className="message-role">
                        {isAssistant ? `${num} assistant` : m.role}
                      </span>

                      <div className="message-actions">
                        <button className="button icon-button" onClick={copyFull}>Copy</button>
                        {m.role==='user' && (
                          <button
                            className="button icon-button"
                            onClick={() => {
                              setEditing(m.id)
                              const txt = Array.isArray(m.content)
                                ? m.content.map(c => c.type==='text'?c.text:'').join('')
                                : String(m.content)
                              setForm(f => ({ ...f, developGoal:txt }))
                            }}
                          >Edit</button>
                        )}
                        <button
                          className="button icon-button"
                          onClick={() => handleDeleteMessage(m.id)}
                        >Del</button>
                      </div>
                    </div>

                    <div className="message-content">
                      {Array.isArray(m.content)
                        ? m.content.map((c,j) =>
                            c.type==='text'
                              ? <div key={j}>{renderRichText(c.text)}</div>
                              : <img key={j} src={c.image_url.url} style={{ maxWidth:200 }}/>)
                        : renderRichText(m.content)}
                    </div>
                  </div>
                )
              })
            })()}
          </div>

          {/* ───────── prompt builder ───────────────────────────*/}
          <PromptBuilder
            mode={mode} setMode={setMode}
            form={form} setForm={setForm}
            loadingSend={loadingSend}
            editingId={editingId}
            handleSend={handleSend}
            handleCopyAll={handleCopyAll}
          />
        </div>
      </div>
      {toast && (
        <Toast
          text={toast.text}
          onUndo={toast.onUndo}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}

/*──────────────────────────────────────────────────────────────────────────
  PromptBuilder – unchanged
──────────────────────────────────────────────────────────────────────────*/
function PromptBuilder ({
  mode, setMode,
  form, setForm,
  loadingSend, editingId,
  handleSend, handleCopyAll
}) {
  const fields = [
    ['GOAL',          'developGoal',         2],
    ['FEATURES',      'developFeatures',     2],
    ['RETURN FORMAT', 'developReturnFormat', 2],
    ['WARNINGS',      'developWarnings',     2],
    ['CONTEXT',       'developContext',      3]
  ]

  return (
    <div className="template-container">
      <div className="template-buttons">
        {['DEVELOP','COMMIT','DIAGNOSE'].map(m => (
          <button
            key={m}
            className={`button ${mode===m ? 'active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode==='DEVELOP' && fields.map(([label,key,rows]) => (
        <div key={key} className="form-group">
          <label>{label}:</label>
          <textarea
            rows={rows}
            className="form-textarea"
            value={form[key]}
            onInput={e => setForm(f => ({ ...f, [key]:e.target.value }))}
          />
        </div>
      ))}

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
  )
}
