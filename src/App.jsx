import { useState, useEffect, useRef } from 'preact/hooks'
import ChatPane from './chatpane.jsx'
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
  useDroppedFiles,
  useMode,
  useTokenCounter
} from './hooks.js'

function App() {
  // --- State & hooks ---
  const [chats, setChats]             = useState([])
  const [currentChatId, setCurrent]   = useState(null)
  const [loadingChats, setLoadingChats] = useState(true)
  const [loadingSend, setLoadingSend]   = useState(false)
  const [editingMessageId, setEditing]  = useState(null)

  const [settings, setSettings] = useSettings()
  const [formData, setFormData] = useFormData()
  const [droppedFiles, setDroppedFiles] = useDroppedFiles()
  const [mode, setMode] = useMode()
  const tokenCounter = useTokenCounter()

  const [tokenCount, setTokenCount] = useState(0)
  const fileInput = useRef()

  // --- Load chats on mount ---
  useEffect(() => {
    (async () => {
      setLoadingChats(true)
      const rows = await fetchChats()
      const shaped = rows.map(r => ({
        id: r.id,
        title: r.title,
        started: r.created_at,
        model: r.code_type,
        messages: []
      }))
      if (!shaped.length) {
        const c = await createChat({ title:'New Chat', model:settings.codeType })
        shaped.push({
          id: c.id, title: c.title,
          started: c.created_at,
          model: c.code_type,
          messages: []
        })
      }
      setChats(shaped)
      setCurrent(shaped[0].id)
      setLoadingChats(false)
    })()
  }, [settings.codeType])

  // --- Fetch messages on chat change ---
  useEffect(() => {
    if (!currentChatId) return
    fetchMessages(currentChatId).then(msgs =>
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: msgs } : c
      ))
    )
  }, [currentChatId])

  // Whenever messages update, recalc tokens
  useEffect(() => {
    if (!currentChatId) return
    const currentChat = chats.find(c => c.id === currentChatId)
    if (!currentChat) return
    // useTokenCounter is async now
    ;(async () => {
      const count = await tokenCounter(currentChat.messages)
      setTokenCount(count)
    })()
  }, [chats, currentChatId, tokenCounter])

  const currentChat = chats.find(c => c.id === currentChatId) || {messages:[]}

  // --- Handlers ---
  async function handleNewChat() {
    setLoadingSend(true)
    const nc = await createChat({ title:'New Chat', model:settings.codeType })
    const shaped = { id:nc.id, title:nc.title, started:nc.created_at, model:nc.code_type, messages:[] }
    setChats(cs => [shaped, ...cs])
    setCurrent(nc.id)
    setLoadingSend(false)
  }

  async function handleSend() {
    if (!currentChatId) return
    if (mode === 'DEVELOP' && !formData.developGoal.trim()) {
      return alert('GOAL is required for DEVELOP mode.')
    }
    setLoadingSend(true)

    let userPrompt = ''
    if (mode === 'DEVELOP') {
      userPrompt = `
MODE: DEVELOP
GOAL: ${formData.developGoal}
FEATURES: ${formData.developFeatures}
RETURN FORMAT: ${formData.developReturnFormat}
WARNINGS: ${formData.developWarnings}
CONTEXT: ${formData.developContext}`.trim()
    }
    else if (mode === 'COMMIT') {
      userPrompt = `MODE: COMMIT\nPlease generate a git‐style commit message.`
    }
    else if (mode === 'DIAGNOSE') {
      userPrompt = `MODE: DIAGNOSE\nPlease analyze any errors or pitfalls.`
    }

    if (editingMessageId) {
      await updateMessage(editingMessageId, userPrompt)
      await archiveMessagesAfter(currentChatId, editingMessageId)
      setEditing(null)
    } else {
      await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: [{ type:'text', text:userPrompt }]
      })
    }

    // Re-fetch + call AI
    const updated = await fetchMessages(currentChatId)
    const { content, error } = await callApiForText({
      apiKey: settings.apiKey,
      model: settings.model,
      messages: updated
    })
    await createMessage({
      chat_id: currentChatId,
      role: 'assistant',
      content: error ? `Error: ${error}` : content
    })
    const final = await fetchMessages(currentChatId)
    setChats(cs => cs.map(c => c.id===currentChatId ? {...c, messages: final} : c))

    // Clear form if not editing
    if (!editingMessageId) {
      setFormData({
        developGoal:'', developFeatures:'', developReturnFormat:'', developWarnings:'', developContext:'', fixCode:'', fixErrors:''
      })
    }
    setLoadingSend(false)
  }

  function handleEditMessage(msg) {
    setEditing(msg.id)
    const text = Array.isArray(msg.content)
      ? msg.content.map(c=>c.type==='text'?c.text:'').join('')
      : String(msg.content)
    setFormData(fd => ({ ...fd, developGoal: text }))
  }

  function handleCopyAll() {
    const txt = currentChat.messages
      .map(m => `${m.role.toUpperCase()}: ${
        Array.isArray(m.content)
          ? m.content.map(c=>c.type==='text'?c.text:'[img]').join('')
          : m.content
      }`)
      .join('\n\n')
    navigator.clipboard.writeText(txt)
  }

  // --- Render ---
  if (loadingChats) {
    return <h2 style={{textAlign:'center',marginTop:'20vh'}}>Loading…</h2>
  }

  return (
    <div className="app-container">
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={setCurrent}
        onDeleteChat={id=>setChats(cs=>cs.filter(c=>c.id!==id))}
      />

      <div className="main-content">
        <div className="top-bar">
          <button className="button" onClick={()=>setSettings(s=>({...s,showSettings:!s.showSettings}))}>
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>konzuko-code</span>
          <select
            value={settings.codeType}
            onChange={e=>setSettings({...settings,codeType:e.target.value})}
            style={{marginRight:'1em'}}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="hugo">Hugo</option>
            <option value="go">Go</option>
          </select>
          <div style={{marginLeft:'auto',padding:'4px 12px',background:'#4f8eff',color:'#fff',borderRadius:'4px'}}>
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                type="text"
                value={settings.apiKey}
                onInput={e=>setSettings({...settings,apiKey:e.target.value})}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e=>setSettings({...settings,model:e.target.value})}
              >
                <option>gpt-4o</option>
                <option>gpt-3.5-turbo</option>
                <option>o3-2025-04-16</option>
              </select>
            </div>
          </div>
        )}

        <div className="content-container">
          <div className="chat-container">
            {currentChat.messages.map((m,idx)=>(
              <div key={idx} className={`message message-${m.role}`}>
                <div className="message-header">
                  <span className="message-role">{m.role}</span>
                  <div className="message-actions">
                    <button
                      className="button icon-button"
                      onClick={()=>navigator.clipboard.writeText(
                        Array.isArray(m.content)
                          ? m.content.map(c=>c.type==='text'?c.text:'').join('')
                          : m.content
                      )}
                    >Copy</button>
                    {m.role==='user' && (
                      <button
                        className="button icon-button"
                        onClick={()=>handleEditMessage(m)}
                      >Edit</button>
                    )}
                  </div>
                </div>
                <div className="message-content">
                  {Array.isArray(m.content)
                    ? m.content.map((c,i)=>c.type==='text'
                        ? <div key={i} style={{whiteSpace:'pre-wrap'}}>{c.text}</div>
                        : <img key={i} src={c.image_url.url} style={{maxWidth:'200px'}}/>)
                    : <div>{m.content}</div>}
                </div>
              </div>
            ))}
          </div>

          <div className="template-container">
            <div className="template-buttons">
              <button className={`button ${mode==='DEVELOP'?'active':''}`} onClick={()=>{setMode('DEVELOP');setEditing(null)}}>
                DEVELOP
              </button>
              <button className={`button ${mode==='COMMIT'?'active':''}`} onClick={()=>{setMode('COMMIT');setEditing(null)}}>
                COMMIT
              </button>
              <button className={`button ${mode==='DIAGNOSE'?'active':''}`} onClick={()=>{setMode('DIAGNOSE');setEditing(null)}}>
                DIAGNOSE
              </button>
            </div>

            {mode==='DEVELOP' && (
              <>
                <div className="form-group">
                  <label>GOAL:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developGoal}
                    onInput={e=>setFormData(fd=>({...fd,developGoal:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label>FEATURES:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developFeatures}
                    onInput={e=>setFormData(fd=>({...fd,developFeatures:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label>RETURN FORMAT:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developReturnFormat}
                    onInput={e=>setFormData(fd=>({...fd,developReturnFormat:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label>WARNINGS:</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    value={formData.developWarnings}
                    onInput={e=>setFormData(fd=>({...fd,developWarnings:e.target.value}))}
                  />
                </div>
                <div className="form-group">
                  <label>CONTEXT:</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    value={formData.developContext}
                    onInput={e=>setFormData(fd=>({...fd,developContext:e.target.value}))}
                  />
                </div>
              </>
            )}

            <button className="button send-button" onClick={handleSend} disabled={loadingSend}>
              {loadingSend ? 'Working…' : editingMessageId ? 'Update & Resend' : 'Send Prompt'}
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