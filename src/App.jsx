// src/App.jsx
import { useState, useEffect, useRef } from 'preact/hooks'
import ChatPane from './chatpane.jsx'
import {
  callApiForText,
  fetchChats,
  fetchMessages,
  createChat,
  createMessage,
  updateMessage as supabaseUpdateMessage,
  archiveMessagesAfter
} from './api.js'
import {
  useSettings,
  useFormData,
  useDroppedFiles,
  useMode,
  useTokenCounter
} from './hooks.js'
import { Tiktoken } from '@dqbd/tiktoken'

const TOKEN_LIMIT = 40000

function App() {
  // State & hooks
  const [chats, setChats]             = useState([])
  const [currentChatId, setCurrent]   = useState(null)
  const [loadingChats, setLoadingChats] = useState(true)
  const [loadingSend, setLoadingSend]   = useState(false)
  const [editingMessageId, setEditing]  = useState(null)

  const [settings, setSettings] = useSettings()          // { apiKey, model, codeType }
  const [formData, setFormData] = useFormData()          // { developGoal, ... }
  const [droppedFiles, setDroppedFiles] = useDroppedFiles()
  const [mode, setMode] = useMode()                      // 'DEVELOP' | 'COMMIT' | 'DIAGNOSE'
  const tokenCounter = useTokenCounter()

  const fileInput = useRef()

  // — load chats on mount
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
      if (shaped.length === 0) {
        const c = await createChat({ title: 'New Chat', model: settings.codeType })
        shaped.push({ id: c.id, title: c.title, started: c.created_at, model: c.code_type, messages: [] })
      }
      setChats(shaped)
      setCurrent(shaped[0].id)
      setLoadingChats(false)
    })()
  }, [settings.codeType])

  // — fetch messages when chat changes
  useEffect(() => {
    if (!currentChatId) return
    fetchMessages(currentChatId).then(msgs => {
      setChats(cs => cs.map(c => c.id === currentChatId ? {...c, messages: msgs} : c))
    })
  }, [currentChatId])

  // — the active chat object
  const currentChat = chats.find(c => c.id === currentChatId) || { messages: [] }

  // — recalc tokens exactly via tiktoken
  const tokenCount = tokenCounter(currentChat.messages)

  // — CREATE / SWITCH CHAT
  async function handleNewChat() {
    const c = await createChat({ title: 'New Chat', model: settings.codeType })
    const shaped = { id: c.id, title: c.title, started: c.created_at, model: c.code_type, messages: [] }
    setChats(cs => [shaped, ...cs])
    setCurrent(c.id)
  }

  // — HANDLE SEND (DEVELOP / COMMIT / DIAGNOSE / EDIT)
  async function handleSend() {
    if (!currentChatId) return
    if (!formData.developGoal.trim() && mode==='DEVELOP') {
      alert('GOAL is required')
      return
    }
    setLoadingSend(true)

    // Build the prompt text
    let userPrompt = ''
    if (mode === 'DEVELOP') {
      userPrompt = `
MODE: DEVELOP
GOAL: ${formData.developGoal}
FEATURES: ${formData.developFeatures}
RETURN FORMAT: ${formData.developReturnFormat}
WARNINGS: ${formData.developWarnings}
CONTEXT: ${formData.developContext}`
    }
    else if (mode === 'COMMIT') {
      userPrompt = `
MODE: COMMIT
Please produce a git-style commit message and summary for the following conversation since the last commit.`
    }
    else if (mode === 'DIAGNOSE') {
      userPrompt = `
MODE: DIAGNOSE
Please analyze any errors or future pitfalls in the following code conversation. Provide only analysis, no code.`
    }

    // if editing a past message
    if (editingMessageId) {
      // 1) update that message
      await supabaseUpdateMessage(editingMessageId, userPrompt)
      // 2) archive all messages after it
      await archiveMessagesAfter(currentChatId, editingMessageId)
      setEditing(null)
    } else {
      // just append user message
      await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: [{ type: 'text', text: userPrompt }]
      })
    }

    // refetch old + send to OpenAI
    const updated = await fetchMessages(currentChatId)
    const reply = await callApiForText({
      apiKey: settings.apiKey,
      model: settings.model,
      messages: updated.map(m => ({
        role: m.role === 'system' ? 'developer' : m.role,
        content: m.content
      }))
    })

    await createMessage({
      chat_id: currentChatId,
      role: 'assistant',
      content: reply.error ? `Error: ${reply.error}` : reply.content
    })

    // finally refresh
    const final = await fetchMessages(currentChatId)
    setChats(cs => cs.map(c => c.id===currentChatId ? {...c, messages: final} : c))

    // clear
    if (!editingMessageId) {
      setFormData({
        developGoal: '', developFeatures: '', developReturnFormat: '',
        developWarnings: '', developContext: '', fixCode: '', fixErrors: ''
      })
    }
    setLoadingSend(false)
  }

  // — RESET to edit a message
  function handleEditMessage(msg) {
    setEditing(msg.id)
    setFormData(fd => ({ ...fd, developGoal: msg.content[0].text })) // assuming single text part
  }

  // — COPY ALL MESSAGES
  function handleCopyAll() {
    const text = currentChat.messages
      .map(m => m.role.toUpperCase() + ': ' +
           (Array.isArray(m.content) ?
              m.content.map(c=>c.type==='text'?c.text:'[img]').join('') :
              m.content))
      .join('\n\n')
    navigator.clipboard.writeText(text)
  }

  // — CONTINUE CHAT after summary
  async function handleContinue() {
    // TODO: call API to summarize the old chat,
    // create a brand new chat with that as first message,
    // and navigate into it.
    alert('⚠️ Continue-Chat not yet implemented.')
  }

  // — DRAG & DROP helper
  function handleDrop(e, field) {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    files.forEach(file => {
      if (file.type.startsWith('text/')) {
        file.text().then(txt => {
          setFormData(fd => ({
            ...fd,
            [field]: fd[field] + `\n/* ${file.name} */\n` + txt
          }))
        })
      }
    })
  }

  // — RENDER
  if (loadingChats) {
    return <h2 style={{textAlign:'center',marginTop:'20vh'}}>Loading…</h2>
  }

  return (
    <div className="app-container">
      {/* sidebar */}
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={setCurrent}
        onDeleteChat={id=>setChats(cs=>cs.filter(c=>c.id!==id))}
      />

      <div className="main-content">
        {/* TOP BAR */}
        <div className="top-bar">
          <button onClick={()=>setSettings(s=>({...s, showSettings:!s.showSettings}))}
                  className="button">
            {settings.showSettings?'Close':'Open'} Settings
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>konzuko-code</span>
          <div className="project-config">
            <label style={{color:'#fff',marginRight:'8px'}}>Codebase:</label>
            <select
              value={settings.codeType}
              onChange={e=>setSettings({...settings,codeType:e.target.value})}
              style={{
                background:'#4f8eff',border:'none',color:'#fff',padding:'4px 8px',borderRadius:'4px'
              }}
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="hugo">Hugo</option>
              <option value="go">Go</option>
            </select>
          </div>
          <div style={{
            marginLeft:'auto',
            padding:'4px 12px',
            background: tokenCount > TOKEN_LIMIT ? 'var(--error)' : 'var(--accent)',
            color:'#fff',
            borderRadius:'4px'
          }}>
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {/* OPTIONAL SETTINGS */}
        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input type="text"
                     value={settings.apiKey}
                     onInput={e=>setSettings({...settings,apiKey:e.target.value})}
                     className="form-input"/>
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select className="form-select"
                      value={settings.model}
                      onChange={e=>setSettings({...settings,model:e.target.value})}>
                <option>gpt-4o</option>
                <option>gpt-4.5-preview</option>
                <option>o3-2025-04-16</option>
                {/* etc */}
              </select>
            </div>
          </div>
        )}

        {/* CHAT & INPUT SIDE BY SIDE */}
        <div className="content-container">
          {/* CHAT MESSAGES */}
          <div className="chat-container">
            {currentChat.messages.map((m,idx)=>(
              <div key={idx} className={`message message-${m.role}`}>
                <div className="message-header">
                  <span className="message-role">{m.role}</span>
                  <div className="message-actions">
                    <button className="button icon-button"
                            onClick={()=>navigator.clipboard.writeText(
                              Array.isArray(m.content)
                                ? m.content.map(c=>c.type==='text'?c.text:'[img]').join('')
                                : m.content
                            )}>
                      Copy
                    </button>
                    {m.role==='user' && (
                      <button className="button icon-button"
                              onClick={()=>handleEditMessage({...m,id:m.id})}
                              disabled={loadingSend}>
                        Edit
                      </button>
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

          {/* INPUT TEMPLATE */}
          <div className="template-container">
            <div className="template-buttons">
              <button
                className={`button ${mode==='DEVELOP'?'active':''}`}
                onClick={()=>{setMode('DEVELOP');setEditing(null)}}>
                DEVELOP
              </button>
              <button
                className={`button ${mode==='COMMIT'?'active':''}`}
                onClick={()=>{setMode('COMMIT');setEditing(null)}}>
                COMMIT
              </button>
              <button
                className={`button ${mode==='DIAGNOSE'?'active':''}`}
                onClick={()=>{setMode('DIAGNOSE');setEditing(null)}}>
                DIAGNOSE
              </button>
            </div>

            {mode==='DEVELOP' && (
              <>
              <div className="form-group">
                <label>GOAL:</label>
                <textarea
                  value={formData.developGoal}
                  onInput={e=>setFormData(fd=>({...fd,developGoal:e.target.value}))}
                  onDrop={e=>handleDrop(e,'developGoal')}
                  className="form-textarea"/>
              </div>
              <div className="form-group">
                <label>FEATURES:</label>
                <textarea
                  value={formData.developFeatures}
                  onInput={e=>setFormData(fd=>({...fd,developFeatures:e.target.value}))}
                  onDrop={e=>handleDrop(e,'developFeatures')}
                  className="form-textarea"/>
              </div>
              <div className="form-group">
                <label>RETURN FORMAT:</label>
                <textarea
                  value={formData.developReturnFormat}
                  onInput={e=>setFormData(fd=>({...fd,developReturnFormat:e.target.value}))}
                  onDrop={e=>handleDrop(e,'developReturnFormat')}
                  className="form-textarea"/>
              </div>
              <div className="form-group">
                <label>WARNINGS:</label>
                <textarea
                  value={formData.developWarnings}
                  onInput={e=>setFormData(fd=>({...fd,developWarnings:e.target.value}))}
                  onDrop={e=>handleDrop(e,'developWarnings')}
                  className="form-textarea"/>
              </div>
              <div className="form-group">
                <label>CONTEXT:</label>
                <textarea
                  value={formData.developContext}
                  onInput={e=>setFormData(fd=>({...fd,developContext:e.target.value}))}
                  onDrop={e=>handleDrop(e,'developContext')}
                  className="form-textarea"/>
              </div>
              </>
            )}

            {/* file/image uploads */}
            <div className="form-group">
              <label>Select / Drag & Drop Files:</label>
              <input
                ref={fileInput}
                type="file" multiple
                onChange={e=>{/* same logic as before */}}
              />
            </div>

            {/* COPY ALL & CONTINUE CHAT */}
            <div className="action-row">
              <button className="button" onClick={handleCopyAll}>
                Copy Everything
              </button>
              {tokenCount > TOKEN_LIMIT && (
                <button className="button warning" onClick={handleContinue}>
                  🔄 Continue Chat
                </button>
              )}
            </div>

            {/* SEND */}
            <button
              className="button send-button"
              onClick={handleSend}
              disabled={loadingSend}
            >
              {loadingSend
                ? 'Working…'
                : editingMessageId
                  ? 'Update & Resend'
                  : mode==='DEVELOP'
                    ? 'Send Prompt'
                    : mode==='COMMIT'
                      ? 'Run Commit'
                      : 'Run Diagnose'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App