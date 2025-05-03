// src/App.jsx
import { useState, useEffect, useCallback } from 'preact/hooks';
import ChatPane      from './chatpane.jsx';
import Toast         from './components/Toast.jsx';
import PromptBuilder from './PromptBuilder.jsx';

import {
  callApiForText,
  fetchChats,
  fetchMessages,
  createChat,
  createMessage,
  updateMessage,
  archiveMessagesAfter,
  deleteMessage,
  undoDeleteMessage,
  deleteChat,
  undoDeleteChat,
  updateChatTitle
} from './api.js';

import {
  useSettings,
  useFormData,
  useMode,
  useTokenCount,
  useUndoableDelete
} from './hooks.js';

export default function App() {
  // ─── state ───────────────────────────────────────────────────────────────
  const [chats, setChats]             = useState([]);
  const [currentChatId, setCurrent]   = useState(null);
  const [loadingChats, setLC]         = useState(true);
  const [loadingSend, setLS]          = useState(false);
  const [toast, setToast]             = useState(null);

  // inline-edit state
  const [editingId, setEditing] = useState(null);
  const [editText,  setEditText] = useState('');

  const [settings, setSettings] = useSettings();
  const [form, setForm]         = useFormData();
  const [mode, setMode]         = useMode();
  const [pendingImages, setPendingImages] = useState([]); // for new sends only

  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  );

  const showToast      = useCallback((t, u) => setToast({ text:t, onUndo:u }), []);
  const undoableDelete = useUndoableDelete(showToast);

  // ─── EFFECTS ─────────────────────────────────────────────────────────────
  // clear inline‐edit if we switch chats
  useEffect(() => {
    setEditing(null);
    setEditText('');
  }, [currentChatId]);

  // load chat list
  useEffect(() => {
    let alive = true;
    (async () => {
      setLC(true);
      try {
        const rows = await fetchChats();
        let shaped = rows.map(r => ({
          id      : r.id,
          title   : r.title,
          started : r.created_at,
          model   : r.code_type,
          messages: []
        }));
        if (!shaped.length) {
          const c = await createChat({ title:'New Chat', model:settings.codeType });
          shaped = [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }];
        }
        if (alive) {
          setChats(shaped);
          setCurrent(shaped[0].id);
        }
      } catch (err) {
        alert('Failed to load chats: ' + err.message);
      } finally {
        alive && setLC(false);
      }
    })();
    return () => { alive = false };
  }, [settings.codeType]);

  // load messages when chat changes
  useEffect(() => {
    if (!currentChatId) return;
    let alive = true;
    fetchMessages(currentChatId)
      .then(msgs => {
        if (!alive) return;
        setChats(cs =>
          cs.map(c => c.id === currentChatId ? { ...c, messages: msgs } : c)
        );
      })
      .catch(err => alert('Failed to fetch messages: ' + err.message));
    return () => { alive = false };
  }, [currentChatId]);

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] };

  // ─── HELPERS ─────────────────────────────────────────────────────────────
  const buildUserPrompt = () => {
    if (mode === 'DEVELOP') {
      return `
MODE: DEVELOP
GOAL: ${form.developGoal}
FEATURES: ${form.developFeatures}
RETURN FORMAT: ${form.developReturnFormat}
THINGS TO REMEMBER/WARNINGS: ${form.developWarnings}
CONTEXT: ${form.developContext}`.trim();
    }
    if (mode === 'COMMIT')   return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (mode === 'DIAGNOSE') return 'MODE: DIAGNOSE\nPlease analyze any errors or pitfalls.';
    return '';
  };

  const resetForm = () => {
    setForm({
      developGoal        : '',
      developFeatures    : '',
      developReturnFormat: '',
      developWarnings    : '',
      developContext     : '',
      fixCode            : '',
      fixErrors          : ''
    });
    setPendingImages([]);
  };

  // ─── CRUD: CHATS ─────────────────────────────────────────────────────────
  async function handleNewChat() {
    setLS(true);
    try {
      const c = await createChat({ title:'New Chat', model:settings.codeType });
      setEditing(null);
      setChats(cs => [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }, ...cs]);
      setCurrent(c.id);
    } catch (err) {
      alert('Failed to create chat: ' + err.message);
    } finally {
      setLS(false);
    }
  }

  async function handleRenameChat(id, newTitle) {
    setChats(cs => cs.map(c => c.id === id ? { ...c, title:newTitle } : c));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      alert('Rename failed: ' + err.message);
      const rows = await fetchChats();
      setChats(rows.map(r => ({
        id:r.id, title:r.title, started:r.created_at, model:r.code_type, messages:[]
      })));
    }
  }

  function handleDeleteChatUI(id) {
    undoableDelete({
      itemLabel  :'Chat',
      deleteFn   :()=>deleteChat(id),
      undoFn     :async()=>{
        await undoDeleteChat(id);
        const rows = await fetchChats();
        const shaped = rows.map(r=>({
          id:r.id, title:r.title, started:r.created_at, model:r.code_type, messages:[]
        }));
        setChats(shaped);
        setCurrent(id);
        const msgs = await fetchMessages(id);
        setChats(cs => cs.map(c => c.id===id?{...c,messages:msgs}:c));
      },
      afterDelete: ()=> setChats(cs => {
        const filtered = cs.filter(c=>c.id!==id);
        if (currentChatId===id) setCurrent(filtered[0]?.id ?? null);
        return filtered;
      })
    });
  }

  // ─── CRUD: MESSAGES ───────────────────────────────────────────────────────
  function handleDeleteMessage(id) {
    undoableDelete({
      itemLabel  :'Message',
      deleteFn   :()=>deleteMessage(id),
      undoFn     :async()=>{
        await undoDeleteMessage(id);
        const msgs = await fetchMessages(currentChatId);
        setChats(cs => cs.map(c => c.id===currentChatId?{...c,messages:msgs}:c));
      },
      afterDelete: ()=> setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:c.messages.filter(m=>m.id!==id) }
            : c
        )
      )
    });
  }

  // ─── INLINE EDIT HANDLERS ─────────────────────────────────────────────────
  function handleStartEdit(m) {
    setEditing(m.id);
    // extract raw text from the blocks
    const raw = Array.isArray(m.content)
      ? m.content.filter(c=>c.type==='text').map(c=>c.text).join('')
      : String(m.content);
    setEditText(raw);
  }

  function handleCancelEdit() {
    setEditing(null);
    setEditText('');
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setLS(true);
    try {
      // 1) overwrite that user message
      await updateMessage(editingId, editText);

      // 2) archive downstream replies
      await archiveMessagesAfter(currentChatId, editingId);

      // 3) fetch cleaned history
      const msgs = await fetchMessages(currentChatId);

      // 4) recall model
      const { content, error } = await callApiForText({
        apiKey   : settings.apiKey,
        model    : settings.model,
        messages : msgs
      });

      // 5) append new assistant reply
      const assistantMsg = await createMessage({
        chat_id : currentChatId,
        role    : 'assistant',
        content : [{ type:'text', text: error ? `Error: ${error}` : content }]
      });

      // 6) update UI
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:[...msgs, assistantMsg] }
            : c
        )
      );
    } catch (err) {
      alert('Update failed: ' + err.message);
    } finally {
      setLS(false);
      setEditing(null);
      setEditText('');
    }
  }

  // ─── NEW MESSAGE SEND ────────────────────────────────────────────────────
  async function handleSend() {
    if (!currentChatId) return;
    if (mode==='DEVELOP' && !form.developGoal.trim()) {
      alert('GOAL is required for DEVELOP mode.');
      return;
    }

    setLS(true);
    try {
      const parts = [
        ...pendingImages.map(img => ({
          type     : 'image_url',
          image_url: { url: img.url, detail: 'auto' }
        })),
        { type: 'text', text: buildUserPrompt() }
      ];

      // save user
      await createMessage({
        chat_id: currentChatId,
        role   : 'user',
        content: parts
      });

      // reset form & images
      resetForm();

      // fetch + call
      const msgs = await fetchMessages(currentChatId);
      const { content, error } = await callApiForText({
        apiKey   : settings.apiKey,
        model    : settings.model,
        messages : msgs
      });

      // assistant
      const assistantMsg = await createMessage({
        chat_id : currentChatId,
        role    : 'assistant',
        content : [{ type:'text', text: error ? `Error: ${error}` : content }]
      });

      // update
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:[...msgs, assistantMsg] }
            : c
        )
      );
    }
    catch (err) {
      alert('Send failed: ' + err.message);
    }
    finally {
      setLS(false);
    }
  }

  // ─── RESEND LAST MESSAGE ─────────────────────────────────────────────────
  async function handleResendMessage(messageId) {
    if (!currentChatId) return;
    setLS(true);
    try {
      await archiveMessagesAfter(currentChatId, messageId);
      const msgs = await fetchMessages(currentChatId);
      const { content, error } = await callApiForText({
        apiKey   : settings.apiKey,
        model    : settings.model,
        messages : msgs
      });
      const assistantMsg = await createMessage({
        chat_id : currentChatId,
        role    : 'assistant',
        content : [{ type:'text', text: error ? `Error: ${error}` : content }]
      });
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:[...msgs, assistantMsg] }
            : c
        )
      );
    } catch (err) {
      alert('Resend failed: ' + err.message);
    } finally {
      setLS(false);
    }
  }

  // ─── COPY ALL TEXT ───────────────────────────────────────────────────────
  function handleCopyAll() {
    const txt = currentChat.messages
      .map(m =>
        Array.isArray(m.content)
          ? m.content.map(c => c.type==='text' ? c.text : '').join('')
          : String(m.content)
      )
      .join('\n\n');
    navigator.clipboard.writeText(txt);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────
  if (loadingChats) {
    return <h2 style={{ textAlign:'center', marginTop:'20vh' }}>Loading…</h2>;
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <ChatPane
        chats         ={chats}
        currentChatId ={currentChatId}
        onNewChat     ={handleNewChat}
        onSelectChat  ={setCurrent}
        onTitleUpdate ={handleRenameChat}
        onDeleteChat  ={handleDeleteChatUI}
      />

      <div className="main-content">
        {/* top-bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={()=> setSettings(s=>({...s,showSettings:!s.showSettings}))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin:'0 1em', fontWeight:'bold' }}>konzuko-code</span>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'0.5em' }}>
            <div style={{padding:'4px 12px',background:'#4f8eff',borderRadius:4}}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>
              Copy All Text
            </button>
          </div>
        </div>

        {/* settings panel */}
        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e=>setSettings(s=>({...s,apiKey:e.target.value}))}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e=>setSettings(s=>({...s,model:e.target.value}))}
              >
                <option value="o4-mini-2025-04-16">o4-mini-2025-04-16</option>
                <option value="o1">o1</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
                <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27</option>
              </select>
            </div>
          </div>
        )}

        {/* content */}
        <div className="content-container" style={{ display:'flex' }}>
          {/* chat messages */}
          <div className="chat-container">
            {currentChat.messages.map((m, idx) => {
              const isAssistant = m.role === 'assistant';
              const isLastUser  = m.role==='user' && idx === currentChat.messages.length - 1;

              // full-text copy helper
              const copyFull = () => {
                const txt = Array.isArray(m.content)
                  ? m.content.map(c=>c.type==='text'?c.text:'').join('')
                  : String(m.content);
                navigator.clipboard.writeText(txt);
              };

              return (
                <div key={m.id} className={`message message-${m.role}`}>
                  {isAssistant && (
                    <div className="floating-controls">
                      <button className="button icon-button" onClick={copyFull}>
                        📋
                      </button>
                    </div>
                  )}

                  <div className="message-header">
                    <span className="message-role">
                      {isAssistant ? `${idx} assistant` : m.role}
                    </span>

                    <div className="message-actions">
                      {/* if we're editing this msg, show Save/Cancel */}
                      {m.id === editingId ? (
                        <>
                          <button
                            className="button"
                            disabled={loadingSend}
                            onClick={handleSaveEdit}
                          >Save</button>
                          <button
                            className="button"
                            disabled={loadingSend}
                            onClick={handleCancelEdit}
                          >Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            className="button icon-button"
                            onClick={copyFull}
                          >Copy</button>

                          {isLastUser && !editingId && (
                            <>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={()=>handleStartEdit(m)}
                              >Edit</button>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={()=>handleResendMessage(m.id)}
                              >Resend</button>
                            </>
                          )}

                          <button
                            className="button icon-button"
                            onClick={()=>handleDeleteMessage(m.id)}
                          >Del</button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="message-content">
                    {m.id === editingId ? (
                      <textarea
                        rows={4}
                        style={{ width:'100%' }}
                        value={editText}
                        onInput={e=>setEditText(e.target.value)}
                      />
                    ) : Array.isArray(m.content) ? (
                      m.content.map((c,j) =>
                        c.type==='text'
                          ? <div key={j}>{c.text}</div>
                          : <img
                              key={j}
                              src={c.image_url.url}
                              alt="img"
                              style={{ maxWidth:200, margin:'8px 0' }}
                            />
                      )
                    ) : (
                      <div style={{ whiteSpace:'pre-wrap' }}>{m.content}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* prompt builder */}
          <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={loadingSend}
              handleSend={handleSend}
              handleCopyAll={handleCopyAll}
              onImageDrop={(name, url)=>
                setPendingImages(a=>[...a,{name,url}])
              }
              onRemoveImage={i=>
                setPendingImages(a=>a.filter((_,j)=>j!==i))
              }
              imagePreviews={pendingImages}
            />
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          text={toast.text}
          onAction={toast.onUndo}
          onClose={()=>setToast(null)}
        />
      )}
    </div>
  );
}
