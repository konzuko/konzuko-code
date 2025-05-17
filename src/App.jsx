/* src/App.jsx */

import {
  useState,
  useEffect,
  useCallback,
  useRef
} from 'preact/hooks';

import ChatPane        from './chatpane.jsx';
import PromptBuilder   from './PromptBuilder.jsx';
import ChatArea        from './components/ChatArea.jsx';
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

import { queue }      from './lib/TaskQueue.js';
import { asciiTree }  from './lib/textUtils.js';

/* ───────────────────── helper utils ───────────────────── */
let queueSetLoading = () => {};
async function runTask(fn) {
  queueSetLoading(true);
  try { await queue.push(fn); }
  catch (err) {
    console.error(err);
    safeAlert(err?.message || 'Unknown error');
  }
  finally { queueSetLoading(false); }
}

function safeAlert(msg) {
  try { alert(msg); } catch { console.error('alert blocked', msg); }
}

function revokeOnce(obj) {
  if (obj?.revoke) { obj.revoke(); obj.revoke = null; }
}

/* =========================================================
   APP COMPONENT
========================================================= */
export default function App() {
  /* ───── state ───── */
  const [chats,         setChats]         = useState([]);
  const [currentChatId, setCurrent]       = useState(null);
  const [loadingChats,  setLoadingChats]  = useState(true);

  const [loadingSend,   setLoadingSend]   = useState(false);
  queueSetLoading = setLoadingSend;

  const [editingId,     setEditing]       = useState(null);
  const [editText,      setEditText]      = useState('');
  const [savingEdit,    setSaving]        = useState(false);

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingFiles,  setPendingFiles]  = useState([]);  // NEW

  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  const busy          = loadingSend || savingEdit;
  const currentChat   = chats.find(c => c.id === currentChatId) ?? { messages: [] };
  const tokenCount    = useTokenCount(currentChat.messages, settings.model);
  const showToast     = useCallback((txt, undo) => Toast(txt, 6000, undo), []);
  const undoableDelete = useUndoableDelete(showToast);

  /* ─────────── load chat list ─────────── */
  useEffect(() => {
    let live = true;
    runTask(async () => {
      setLoadingChats(true);
      const rows = await fetchChats();
      let shaped = rows.map(r => ({
        id: r.id, title: r.title, started: r.created_at,
        model: r.code_type, messages: []
      }));
      if (!shaped.length) {
        const c = await createChat({ title:'New Chat', model:settings.codeType });
        shaped = [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }];
      }
      if (live) { setChats(shaped); setCurrent(shaped[0].id); }
    }).finally(() => live && setLoadingChats(false));
    return () => { live = false; };
  }, [settings.codeType]);

  /* ─────────── load messages for active chat ─────────── */
  useEffect(() => {
    if (!currentChatId) return;
    let live = true;
    fetchMessages(currentChatId)
      .then(msgs => live && setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: msgs } : c
      )))
      .catch(err => safeAlert('Failed to fetch messages: ' + err.message));
    return () => { live = false; };
  }, [currentChatId]);

  /* ─────────── chat scroll helpers ─────────── */
  const chatBoxRef = useRef(null);
  const scrollToPrev = () => {
    const box = chatBoxRef.current; if (!box) return;
    const rows = Array.from(box.querySelectorAll('.message'));
    const cur  = box.scrollTop;
    let tgt = null;
    for (let i = rows.length-1; i >= 0; i--)
      if (rows[i].offsetTop < cur-1) { tgt = rows[i]; break; }
    box.scrollTop = tgt ? tgt.offsetTop : 0;
  };
  const scrollToNext = () => {
    const box = chatBoxRef.current; if (!box) return;
    const rows = Array.from(box.querySelectorAll('.message'));
    const cur  = box.scrollTop;
    let tgt = null;
    for (let i = 0; i < rows.length; i++)
      if (rows[i].offsetTop > cur+1) { tgt = rows[i]; break; }
    box.scrollTop = tgt ? tgt.offsetTop : box.scrollHeight;
  };

  /* =========================================================
     Chat-level helpers
  ========================================================= */
  function handleNewChat() {
    if (busy) return;
    runTask(async () => {
      const c = await createChat({ title:'New Chat', model: settings.codeType });
      setChats(cs => [{ id:c.id, title:c.title, started:c.created_at, model:c.code_type, messages:[] }, ...cs]);
      setCurrent(c.id);
    });
  }

  function handleRenameChat(id, title) {
    setChats(cs => cs.map(c => c.id === id ? { ...c, title } : c));
    runTask(() => updateChatTitle(id, title)
      .catch(err => safeAlert('Rename failed: ' + err.message)));
  }

  function handleDeleteChatUI(id) {
    if (busy) return;
    const anchorId = currentChatId;
    undoableDelete({
      itemLabel  : 'Chat',
      deleteFn   : () => runTask(() => deleteChat(id)),
      undoFn     : () => runTask(async () => {
        await undoDeleteChat(id);
        const rows = await fetchChats();
        const shaped = rows.map(r => ({
          id: r.id, title: r.title, started: r.created_at,
          model: r.code_type, messages: []
        }));
        setChats(shaped);
        setCurrent(shaped.find(c => c.id === id)?.id ?? shaped[0]?.id ?? null);
      }),
      afterDelete: () => {
        setChats(cs => {
          const filtered = cs.filter(c => c.id !== id);
          if (anchorId === id) setCurrent(filtered[0]?.id ?? null);
          return filtered;
        });
      }
    });
  }

  /* =========================================================
     Prompt builder helpers
  ========================================================= */
  function buildUserPrompt() {
    if (mode === 'DEVELOP') {
      const L = ['MODE: DEVELOP'];
      if (form.developGoal.trim())
        L.push(`GOAL: ${form.developGoal.trim()}`);
      if (form.developFeatures.trim())
        L.push(`FEATURES: ${form.developFeatures.trim()}`);
      if (form.developReturnFormat.trim())
        L.push(`RETURN FORMAT: ${form.developReturnFormat.trim()}`);
      if (form.developWarnings.trim())
        L.push(`THINGS TO REMEMBER/WARNINGS: ${form.developWarnings.trim()}`);
      if (form.developContext.trim())
        L.push(`CONTEXT: ${form.developContext.trim()}`);

      /* ───── file structure (only in-root files) */
      const treePaths = pendingFiles
        .filter(f => f.insideProject)
        .map(f => f.fullPath);

      if (treePaths.length) {
        const tree = asciiTree(treePaths);
        L.push(`/* File structure:\n${tree}\n*/`);
      }

      /* ───── individual files (all of them) */
      pendingFiles.forEach(f => {
        /* YAML header */
        L.push('```yaml');
        L.push(`file: ${f.fullPath}`);
        if (f.note) L.push(`# ${f.note}`);
        L.push('```');

        /* code block */
        L.push('```');
        L.push(f.text);
        L.push('```');
      });

      return L.join('\n');
    }

    if (mode === 'COMMIT')
      return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (mode === 'CODE CHECK')
      return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    return '';
  }

  function resetForm() {
    pendingImages.forEach(revokeOnce);
    setPendingFiles([]);
    setForm({
      developGoal:'', developFeatures:'', developReturnFormat:'',
      developWarnings:'', developContext:'',
      fixCode:'', fixErrors:''
    });
    setPendingImages([]);
  }

  /* =========================================================
     Send
  ========================================================= */
  function handleSend() {
    if (busy) return;
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      safeAlert('GOAL is required for DEVELOP mode.'); return;
    }

    runTask(async () => {
      /* user row */
      const prompt  = buildUserPrompt();
      const userRow = await createMessage({
        chat_id: currentChatId,
        role   : 'user',
        content: [{ type:'text', text: prompt }]
      });
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages:[...c.messages, userRow] } : c
      ));

      /* model messages array */
      const msgs    = [...currentChat.messages, userRow];
      const lastIdx = msgs.length - 1;

      /* attach images */
      if (pendingImages.length && msgs[lastIdx]?.role === 'user') {
        const toBlock = async img => {
          const blob = await fetch(img.url).then(r => r.blob());
          const dataUrl = await new Promise(res => {
            const fr=new FileReader(); fr.onloadend=()=>res(fr.result); fr.readAsDataURL(blob);
          });
          revokeOnce(img);
          return { type:'image_url', image_url:{ url:dataUrl, detail:'auto' } };
        };
        const imgBlocks = await Promise.all(pendingImages.map(toBlock));
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          content: [...imgBlocks, { type:'text', text: prompt }]
        };
      }

      /* call model */
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model : settings.model,
        messages: msgs
      });

      /* assistant row */
      const asst = await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: [{ type:'text', text: error ? `Error: ${error}` : content }]
      });
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages:[...c.messages, asst] } : c
      ));

      resetForm();

      /* final refresh */
      const refreshed = await fetchMessages(currentChatId);
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: refreshed } : c
      ));
    });
  }

  /* =========================================================
     Message-level helpers (edit / resend / delete)
     — identical to original implementation
  ========================================================= */
  function handleStartEdit(msg) {
    setEditing(msg.id);
    const txt = Array.isArray(msg.content)
      ? msg.content.filter(b=>b.type==='text').map(b=>b.text).join('')
      : String(msg.content);
    setEditText(txt);
  }
  function handleCancelEdit() { setEditing(null); setEditText(''); }

  async function handleSaveEdit() {
    if (!editingId || busy) return;
    setSaving(true);

    runTask(async () => {
      const msgs = await fetchMessages(currentChatId);
      const idx  = msgs.findIndex(x => x.id === editingId);
      if (idx === -1) throw new Error('Message not found');

      await updateMessage(editingId, editText);
      msgs[idx] = { ...msgs[idx], content:[{ type:'text', text: editText }] };

      await archiveMessagesAfter(currentChatId, msgs[idx].created_at);

      const { content, error } = await callApiForText({
        apiKey: settings.apiKey, model: settings.model,
        messages: msgs.slice(0, idx+1)
      });

      await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: [{ type:'text', text: error ? `Error: ${error}` : content }]
      });

      const refreshed = await fetchMessages(currentChatId);
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: refreshed } : c
      ));
      setEditing(null); setEditText('');
    }).finally(() => setSaving(false));
  }

  function handleResendMessage(id) {
    if (busy) return;
    runTask(async () => {
      const msgs   = await fetchMessages(currentChatId);
      const anchor = msgs.find(x => x.id === id);
      if (!anchor) throw new Error('Message not found');

      await archiveMessagesAfter(currentChatId, anchor.created_at);
      const trimmed = await fetchMessages(currentChatId);

      const { content, error } = await callApiForText({
        apiKey: settings.apiKey, model: settings.model, messages: trimmed
      });

      const asst = await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: [{ type:'text', text: error ? `Error: ${error}` : content }]
      });
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages:[...trimmed, asst] } : c
      ));

      showToast('Archived messages. Undo?', () =>
        runTask(async () => {
          await undoArchiveMessagesAfter(currentChatId, anchor.created_at);
          await deleteMessage(asst.id);
          const undone = await fetchMessages(currentChatId);
          setChats(u => u.map(cc =>
            cc.id === currentChatId ? { ...cc, messages: undone } : cc
          ));
        })
      );
    });
  }

  function handleDeleteMessage(id) {
    if (id === editingId) { setEditing(null); setEditText(''); }
    if (busy) return;
    undoableDelete({
      itemLabel  : 'Message',
      deleteFn   : () => runTask(() => deleteMessage(id)),
      undoFn     : () => runTask(async () => {
        await undoDeleteMessage(id);
        const msgs = await fetchMessages(currentChatId);
        setChats(cs => cs.map(c =>
          c.id === currentChatId ? { ...c, messages: msgs } : c
        ));
      }),
      afterDelete: () => {
        setChats(cs => cs.map(c =>
          c.id === currentChatId
            ? { ...c, messages:c.messages.filter(m=>m.id!==id) }
            : c
        ));
      }
    });
  }

  /* =========================================================
     Copy conversation helper
  ========================================================= */
  function handleCopyAll() {
    const txt = currentChat.messages.map(m =>
      Array.isArray(m.content)
        ? m.content.filter(b=>b.type==='text').map(b=>b.text).join('')
        : String(m.content)
    ).join('\n\n');
    navigator.clipboard.writeText(txt)
      .catch(() => safeAlert('Copy failed (clipboard API)'));
  }

  /* =========================================================
     UI
  ========================================================= */
  if (loadingChats) {
    return <h2 style={{textAlign:'center',marginTop:'20vh'}}>Loading…</h2>;
  }

  return (
    <div className="app-container">
      {/* ─── sidebar ─── */}
      <ChatPane
        chats          ={chats}
        currentChatId  ={currentChatId}
        onSelectChat   ={setCurrent}
        onNewChat      ={handleNewChat}
        onTitleUpdate  ={handleRenameChat}
        onDeleteChat   ={handleDeleteChatUI}
        disabled       ={busy}
      />

      {/* ─── main column ─── */}
      <div className="main-content">
        {/* top bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>konzuko-code</span>
          <div style={{marginLeft:'auto',display:'flex',gap:'0.5em'}}>
            <div style={{padding:'4px 12px',background:'#4f8eff',borderRadius:4}}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>Copy All Text</button>
          </div>
        </div>

        {/* settings panel (unchanged) */}
        {settings.showSettings && (
          <div className="settings-panel" style={{padding:'1em',borderBottom:'1px solid var(--border)'}}>
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e => setSettings(s => ({ ...s, apiKey:e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e => setSettings(s => ({ ...s, model:e.target.value }))}
              >
                <option value="o4-mini-2025-04-16">o4-mini-2025-04-16</option>
                <option value="o1">o1</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
                <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
              </select>
            </div>
          </div>
        )}

        <div className="content-container" style={{display:'flex',flex:1}}>
          {/* chat column */}
          <div className="chat-container" ref={chatBoxRef}>
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev}>↑</button>
              <button className="button icon-button" onClick={scrollToNext}>↓</button>
            </div>
            <ChatArea
              messages            ={currentChat.messages}
              editingId           ={editingId}
              editText            ={editText}
              loadingSend         ={busy}
              savingEdit          ={savingEdit}
              setEditText         ={setEditText}
              handleSaveEdit      ={handleSaveEdit}
              handleCancelEdit    ={handleCancelEdit}
              handleStartEdit     ={handleStartEdit}
              handleResendMessage ={handleResendMessage}
              handleDeleteMessage ={handleDeleteMessage}
            />
          </div>

          {/* prompt builder column */}
          <div style={{width:'50%',display:'flex',flexDirection:'column',overflowY:'auto'}}>
            <PromptBuilder
              mode          ={mode}            setMode       ={setMode}
              form          ={form}            setForm       ={setForm}
              loadingSend   ={busy}            handleSend    ={handleSend}
              showToast     ={showToast}
              onImageDrop   ={setPendingImages}
              onRemoveImage ={i=>{
                setPendingImages(a=>{
                  revokeOnce(a[i]);
                  return a.filter((_,j)=>j!==i);
                });
              }}
              imagePreviews ={pendingImages}
              settings      ={settings}
              pendingFiles  ={pendingFiles}
              onFilesChange ={setPendingFiles}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
