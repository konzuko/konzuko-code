
import { useState, useEffect, useCallback } from 'preact/hooks';
import ChatPane        from './chatpane.jsx';
import PromptBuilder   from './PromptBuilder.jsx';
import Toast           from './components/Toast.jsx';

import {
  callApiForText,
  fetchChats,
  fetchMessages,
  createChat,
  createMessage,
  updateMessage,
  deleteMessage,
  deleteChat,
  archiveMessagesAfter,
  undoArchiveMessagesAfter,
  undoDeleteMessage,
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

import { queue } from './lib/TaskQueue.js';

/*───────────── safe alert fallback ─────────────*/
function safeAlert(msg) {
  try { alert(msg); }
  catch(e) { console.error('alert blocked', msg, e); }
}

/*───────────── wrapper for queue + loadingSend ─────────────*/
let queueSetLoading = () => {};

async function runTask(taskFn) {
  queueSetLoading(true);
  try {
    await queue.push(taskFn);
  } catch (err) {
    console.error('runTask error:', err);
    safeAlert(err?.message || 'Unknown error');
    throw err;
  } finally {
    queueSetLoading(false);
  }
}

/*────────────── code fences + copy button ──────────────
  Splits on triple-backtick blocks and wraps each in a 
  <pre> with a small 📋 button. 
*/
function renderWithCodeButtons(text) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const code = part.slice(3, -3).trim();
      return (
        <div key={i} style={{ position:'relative', margin:'8px 0' }}>
          <button
            className="copy-snippet"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            📋
          </button>
          <pre className="code-block">{code}</pre>
        </div>
      );
    }
    return (
      <div key={i} style={{ whiteSpace:'pre-wrap' }}>
        {part}
      </div>
    );
  });
}

/*──────────────────────────────────────────────────────── App ─────────────*/
export default function App() {
  // ───────────────────────────── State ───────────────────────────
  const [chats,         setChats]        = useState([]);
  const [currentChatId, setCurrent]      = useState(null);
  const [loadingChats,  setLC]           = useState(true);
  const [loadingSend,   setLoadingSend]  = useState(false);

  // Inline Edit
  const [editingId,  setEditing]        = useState(null);
  const [editText,   setEditText]       = useState('');
  const [savingEdit, setSavingEdit]     = useState(false);

  // Toast + ephemeral images
  const [toast, setToast]               = useState(null);
  const [pendingImages, setPendingImages] = useState([]);

  // Form, mode, settings
  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  // Token usage
  const tokenCount = useTokenCount(
    chats.find(c=> c.id===currentChatId)?.messages ?? [],
    settings.model
  );

  // wire queue-runner → loadingSend
  useEffect(() => { queueSetLoading = setLoadingSend; }, [setLoadingSend]);

  // clear editing on chat switch
  useEffect(() => { setEditing(null); setEditText(''); }, [currentChatId]);

  // toast helper
  const showToast = useCallback((text, onUndo) => {
    setToast({ text, onUndo });
  }, []);
  const undoableDelete = useUndoableDelete(showToast);

  // ───────────────────────────── 1) load chat list ───────────────────────
  useEffect(() => {
    let alive = true;
    runTask(async () => {
      setLC(true);
      const rows = await fetchChats();
      let shaped = rows.map(r => ({
        id      : r.id,
        title   : r.title,
        started : r.created_at,
        model   : r.code_type,
        messages: []
      }));

      if (!shaped.length) {
        const c = await createChat({ title:'New Chat', model: settings.codeType });
        shaped = [{
          id      : c.id,
          title   : c.title,
          started : c.created_at,
          model   : c.code_type,
          messages: []
        }];
      }
      if (alive) {
        setChats(shaped);
        setCurrent(shaped[0].id);
      }
    }).finally(() => {
      if (alive) setLC(false);
    });
    return () => { alive=false; };
  }, [settings.codeType]);

  // ───────────────────────────── 2) load messages ───────────────────────
  useEffect(() => {
    if (!currentChatId) return;
    let live = true;
    fetchMessages(currentChatId)
      .then(msgs => {
        if (!live) return;
        setChats(cs =>
          cs.map(c => c.id===currentChatId ? {...c,messages:msgs} : c)
        );
      })
      .catch(err => safeAlert('Failed to fetch msgs: ' + err.message));
    return () => { live=false; };
  }, [currentChatId]);

  // current chat object
  const currentChat = chats.find(c=> c.id===currentChatId) ?? { messages:[] };

  // ───────────────────────────── Prompt builder helper ──────────────────
  function buildUserPrompt() {
    if (mode==='DEVELOP') {
      const lines = ['MODE: DEVELOP'];
      if (form.developGoal.trim())         lines.push(`GOAL: ${form.developGoal.trim()}`);
      if (form.developFeatures.trim())     lines.push(`FEATURES: ${form.developFeatures.trim()}`);
      if (form.developReturnFormat.trim()) lines.push(`RETURN FORMAT: ${form.developReturnFormat.trim()}`);
      if (form.developWarnings.trim())     lines.push(`THINGS TO REMEMBER/WARNINGS: ${form.developWarnings.trim()}`);
      if (form.developContext.trim())      lines.push(`CONTEXT: ${form.developContext.trim()}`);
      return lines.join('\n');
    }
    if (mode==='COMMIT') {
      return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    }
    if (mode==='CODE CHECK') {
      return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    }
    return '';
  }

  function resetForm() {
    setForm({
      developGoal:'',developFeatures:'',developReturnFormat:'',
      developWarnings:'',developContext:'',fixCode:'',fixErrors:''
    });
    setPendingImages([]);
  }

  // ───────────────────────────── Copy entire chat ───────────────────────
  function handleCopyAll() {
    const txt = currentChat.messages.map(m =>
      Array.isArray(m.content)
        ? m.content.filter(b=>b.type==='text').map(b=>b.text).join('')
        : String(m.content)
    ).join('\n\n');
    navigator.clipboard.writeText(txt);
  }

  // ───────────────────────────── handleSend ─────────────────────────────
  function handleSend() {
    if (loadingSend) return;
    if (mode==='DEVELOP' && !form.developGoal.trim()) {
      safeAlert('GOAL is required for DEVELOP mode.');
      return;
    }

    runTask(async () => {
      const prompt = buildUserPrompt();

      // dedupe images by data-url
      const uniqueImgs = Array.from(new Map(
        pendingImages.map(i => [i.url, i])
      ).values());

      // user sends text + images, but in DB we store text only
      const apiBlocks = [
        ...uniqueImgs.map(img => ({
          type:'image_url',
          image_url:{ url:img.url, detail:'auto' }
        })),
        { type:'text', text: prompt }
      ];

      /* 1) create user in DB with plain text */
      const userRow = await createMessage({
        chat_id: currentChatId,
        role   : 'user',
        content:[{ type:'text', text:prompt }]
      });

      /* 2) local update to show user message immediately */
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:[...c.messages, userRow] }
            : c
        )
      );

      /* 3) re-fetch to ensure we have the final array (including userRow) */
      const fresh = await fetchMessages(currentChatId);
      // replace the last user row’s plain text with “images + text”
      let msgsForAi = [...fresh];
      msgsForAi[msgsForAi.length - 1] = {
        ...msgsForAi[msgsForAi.length - 1],
        content: apiBlocks
      };

      /* 4) call LLM */
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model : settings.model,
        messages: msgsForAi
      });

      /* 5) create assistant in DB + local */
      const asstRow = await createMessage({
        chat_id: currentChatId,
        role:'assistant',
        content:[{ type:'text', text: error?`Error: ${error}`:content }]
      });
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId
            ? { ...c, messages:[...c.messages, asstRow] }
            : c
        )
      );

      resetForm();
    });
  }

  // ───────────────────────────── handleSaveEdit (slice) ─────────────────
  function handleSaveEdit() {
    if (!editingId || loadingSend || savingEdit) return;
    setSavingEdit(true);

    runTask(async () => {
      let msgs = await fetchMessages(currentChatId);
      const anchorIdx = msgs.findIndex(m => m.id===editingId);
      if (anchorIdx===-1) throw new Error('Message not found for editing');

      // 1) update DB
      await updateMessage(editingId, editText);

      // 2) fix local
      msgs[anchorIdx] = {
        ...msgs[anchorIdx],
        content:[{ type:'text', text: editText }]
      };

      // 3) archive everything after
      await archiveMessagesAfter(currentChatId, msgs[anchorIdx].created_at);

      // 4) slice so LLM sees up to anchor only
      const msgsForAi = msgs.slice(0, anchorIdx+1);

      // 5) LLM
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model : settings.model,
        messages: msgsForAi
      });

      // 6) insert new assistant
      await createMessage({
        chat_id: currentChatId,
        role:'assistant',
        content:[{ type:'text', text: error?`Error: ${error}`:content }]
      });

      // 7) final refresh
      const updated = await fetchMessages(currentChatId);
      setChats(cs =>
        cs.map(c =>
          c.id===currentChatId ? { ...c, messages: updated } : c
        )
      );

      setEditing(null);
      setEditText('');
    }).finally(()=>setSavingEdit(false));
  }

  // ───────────────────────────── handleNewChat ──────────────────────────
  function handleNewChat() {
    if (loadingSend) return;
    runTask(async () => {
      const c = await createChat({ title:'New Chat', model:settings.codeType });
      setEditing(null);
      setChats(cs => [{
        id:c.id, title:c.title, started:c.created_at,
        model:c.code_type, messages:[]
      }, ...cs]);
      setCurrent(c.id);
    });
  }

  // ───────────────────────────── handleRenameChat ───────────────────────
  async function handleRenameChat(id, newTitle) {
    setChats(cs => cs.map(c => c.id===id ? { ...c, title:newTitle } : c));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      safeAlert('Rename failed: ' + err.message);
      const rows = await fetchChats();
      const shaped = rows.map(r => ({
        id:r.id, title:r.title, started:r.created_at,
        model:r.code_type, messages:[]
      }));
      setChats(shaped);
    }
  }

  // ───────────────────────────── handleDeleteChatUI ─────────────────────
  function handleDeleteChatUI(id) {
    if (loadingSend) return;
    const anchorChatId = currentChatId;
    runTask(() =>
      undoableDelete({
        itemLabel:'Chat',
        deleteFn: () => deleteChat(id),
        undoFn: () => runTask(async () => {
          await undoDeleteChat(id);
          const rows = await fetchChats();
          const shaped = rows.map(r=>({
            id:r.id,title:r.title,started:r.created_at,
            model:r.code_type,messages:[]
          }));
          setChats(shaped);
          const found = shaped.find(c => c.id===id);
          setCurrent(found ? found.id : shaped[0]?.id ?? null);
        }),
        afterDelete: () => {
          setChats(cs => {
            const filtered = cs.filter(c => c.id!==id);
            if (anchorChatId===id) {
              if (filtered.length) setCurrent(filtered[0].id);
              else setCurrent(null);
            }
            return filtered;
          });
        }
      })
    );
  }

  // ───────────────────────────── handleDeleteMessage ────────────────────
  function handleDeleteMessage(id) {
    if (id===editingId) {
      setEditing(null);
      setEditText('');
    }
    if (loadingSend) return;
    const anchorChatId = currentChatId;
    runTask(() =>
      undoableDelete({
        itemLabel:'Message',
        deleteFn: () => deleteMessage(id),
        undoFn: () => runTask(async () => {
          await undoDeleteMessage(id);
          const msgs = await fetchMessages(anchorChatId);
          setChats(cs => cs.map(c => c.id===anchorChatId?{...c,messages:msgs}:c));
        }),
        afterDelete: () => {
          setChats(cs => cs.map(
            c => c.id===anchorChatId
              ? {...c,messages:c.messages.filter(m=>m.id!==id)}
              : c
          ));
        }
      })
    );
  }

  // ───────────────────────────── handleStartEdit / CancelEdit ───────────
  function handleStartEdit(m) {
    if (loadingSend) return;
    setEditing(m.id);
    const raw = Array.isArray(m.content)
      ? m.content.filter(b=>b.type==='text').map(b=>b.text).join('')
      : String(m.content);
    setEditText(raw);
  }
  function handleCancelEdit() {
    setEditing(null);
    setEditText('');
  }

  // ───────────────────────────── handleResendMessage ────────────────────
  function handleResendMessage(id) {
    if (loadingSend) return;
    const anchorChatId=currentChatId;
    runTask(async ()=>{
      const msgs=await fetchMessages(anchorChatId);
      const anchor=msgs.find(x=>x.id===id);
      if(!anchor) throw new Error('Message not found');

      // 1) archive everything after anchor
      await archiveMessagesAfter(anchorChatId, anchor.created_at);

      // 2) re-fetch
      const trimmed=await fetchMessages(anchorChatId);

      // 3) LLM
      const { content, error }=await callApiForText({
        apiKey: settings.apiKey,
        model : settings.model,
        messages: trimmed
      });

      // 4) create assistant
      const asst=await createMessage({
        chat_id:anchorChatId, role:'assistant',
        content:[{type:'text', text:error?`Error: ${error}`:content}]
      });

      // 5) local
      setChats(cs=> cs.map(c=>
        c.id===anchorChatId?{...c,messages:[...trimmed, asst]}:c
      ));

      // 6) toast for undo
      showToast('Archived messages. Undo?', ()=>
        runTask(async ()=>{
          await undoArchiveMessagesAfter(anchorChatId, anchor.created_at);
          await deleteMessage(asst.id);
          const undone=await fetchMessages(anchorChatId);
          setChats(u=> u.map(cc=> cc.id===anchorChatId?{...cc,messages:undone}:cc));
        })
      );
    });
  }

  // ───────────────────────────── final render ───────────────────────────
  if (loadingChats) {
    return <h2 style={{textAlign:'center',marginTop:'20vh'}}>Loading…</h2>;
  }

  return (
    <div className="app-container">
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={setCurrent}
        onNewChat={handleNewChat}
        onTitleUpdate={handleRenameChat}
        onDeleteChat={handleDeleteChatUI}
        disabled={loadingSend}
      />

      <div className="main-content">
        {/* top bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={()=> setSettings(s=>({...s,showSettings:!s.showSettings}))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>konzuko-code</span>

          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'0.5em'}}>
            <div style={{padding:'4px 12px',background:'#4f8eff',borderRadius:4}}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>
              Copy All Text
            </button>
          </div>
        </div>

        {settings.showSettings && (
          <div className="settings-panel" style={{padding:'1em',borderBottom:'1px solid var(--border)'}}>
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e=> setSettings(s=>({...s, apiKey:e.target.value}))}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e=> setSettings(s=>({...s, model:e.target.value}))}
              >
                <option value="o4-mini-2025-04-16">o4-mini-2025-04-16</option>
                <option value="o1">o1</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
                <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27</option>
              </select>
            </div>
          </div>
        )}

        <div className="content-container" style={{ display:'flex', flex:1 }}>
          {/* chat messages */}
          <div className="chat-container" style={{width:'50%', overflowY:'auto', padding:'16px', borderRight:'1px solid var(--border)'}}>
            {currentChat.messages.map((m,idx)=>{
              const isAssistant = (m.role==='assistant');
              const copyFull = () => {
                if(Array.isArray(m.content)){
                  const txt = m.content
                    .filter(b=>b.type==='text')
                    .map(b=>b.text)
                    .join('');
                  navigator.clipboard.writeText(txt);
                } else {
                  navigator.clipboard.writeText(String(m.content));
                }
              };

              const isLastUser = (
                m.role==='user' &&
                idx===currentChat.messages.length-1 &&
                !editingId
              );

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
                      {isAssistant ? `assistant #${idx}` : m.role}
                    </span>
                    <div className="message-actions">
                      {m.id===editingId ? (
                        <>
                          <button
                            className="button"
                            disabled={loadingSend || savingEdit}
                            onClick={handleSaveEdit}
                          >
                            {savingEdit ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            className="button"
                            disabled={loadingSend}
                            onClick={()=>{setEditing(null); setEditText('');}}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="button icon-button" onClick={copyFull}>Copy</button>
                          {isLastUser && (
                            <>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={()=>handleStartEdit(m)}
                              >
                                Edit
                              </button>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={()=>handleResendMessage(m.id)}
                              >
                                Resend
                              </button>
                            </>
                          )}
                          <button
                            className="button icon-button"
                            disabled={loadingSend}
                            onClick={()=>handleDeleteMessage(m.id)}
                          >
                            Del
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="message-content">
                    {m.id===editingId ? (
                      <textarea
                        rows={4}
                        style={{width:'100%'}}
                        value={editText}
                        onInput={e=>setEditText(e.target.value)}
                      />
                    ) : Array.isArray(m.content) ? (
                      m.content.map((c, j)=>{
                        if(c.type==='text'){
                          return <div key={j}>{renderWithCodeButtons(c.text)}</div>;
                        }
                        if(c.type==='image_url'){
                          return (
                            <img
                              key={j}
                              src={c.image_url?.url||''}
                              alt="img"
                              style={{maxWidth:'200px',margin:'8px 0'}}
                            />
                          );
                        }
                        return null;
                      })
                    ) : (
                      <div style={{whiteSpace:'pre-wrap'}}>
                        {renderWithCodeButtons(String(m.content))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* PromptBuilder side */}
          <div style={{width:'50%', display:'flex', flexDirection:'column', overflowY:'auto'}}>
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={loadingSend}
              handleSend={handleSend}
              onImageDrop={(name,url)=>setPendingImages(a=>[...a,{name,url}])}
              onRemoveImage={i=>setPendingImages(a=>a.filter((_,j)=>j!==i))}
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
