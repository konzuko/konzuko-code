/* ──────────────────────────────────────────────────────────────────
   src/App.jsx            —  FULL FILE, NO OMISSIONS
   • Replaces the big .map() loop with <ChatArea> (memoised)
   • Keeps all business-logic helpers (send / edit / delete / undo)
   • Leaves nav-rail DOM math untouched (works because all rows exist)
   • Clipboard “Copy-all” failure now calls safeAlert (non-blocking)
   • Uses the original Toast (undo) mechanics exactly as before
─────────────────────────────────────────────────────────────────── */
import {
  useState,
  useEffect,
  useCallback,
  useRef
} from 'preact/hooks';

import ChatPane        from './chatpane.jsx';
import PromptBuilder   from './PromptBuilder.jsx';
import Toast           from './components/Toast.jsx';      // undo-toast helper
import ChatArea        from './components/ChatArea.jsx';   // NEW

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

/* ───────── helper so we can show loading while queue runs ───────── */
let queueSetLoading = () => {};
async function runTask(taskFn) {
  queueSetLoading(true);
  try   { await queue.push(taskFn); }
  catch (err) { console.error(err); safeAlert(err?.message || 'Unknown error'); }
  finally { queueSetLoading(false); }
}

/* Fallback alert if blocked (mobile Safari, etc.) */
function safeAlert(msg) {
  try { alert(msg); }
  catch (e) { console.error('alert blocked', msg, e); }
}

/* Revoke an image blob URL exactly once */
function revokeOnce(img) {
  if (img?.revoke) {
    img.revoke();
    img.revoke = null;
  }
}

/* =================================================================
   APP  COMPONENT
================================================================= */
export default function App() {
  /* ─────────── state buckets ─────────── */
  const [chats,         setChats]         = useState([]);
  const [currentChatId, setCurrent]       = useState(null);
  const [loadingChats,  setLC]            = useState(true);
  const [loadingSend,   setLoadingSend]   = useState(false);

  const [editingId,     setEditing]       = useState(null);
  const [editText,      setEditText]      = useState('');
  const [savingEdit,    setSaving]        = useState(false);

  const [toast,         setToast]         = useState(null);   // undo toast
  const [pendingImages, setPendingImages] = useState([]);

  /* user settings & draft form */
  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  /* live token counter */
  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  );

  /* showToast(text, onUndo?)  – handshake around the Toast helper */
  const showToast = useCallback((text, onUndo) => {
    setToast({ text, onUndo });
  }, []);

  const undoableDelete = useUndoableDelete(showToast);

  /* plug queue runner */
  useEffect(() => { queueSetLoading = setLoadingSend; }, []);

  /* ─────────── LOAD chat list once ─────────── */
  useEffect(() => {
    let live = true;
    runTask(async () => {
      setLC(true);
      const rows = await fetchChats();

      let shaped = rows.map(r => ({
        id:       r.id,
        title:    r.title,
        started:  r.created_at,
        model:    r.code_type,
        messages: []
      }));

      /* create a starter chat if none exist */
      if (shaped.length === 0) {
        const c = await createChat({ title: 'New Chat', model: settings.codeType });
        shaped = [{
          id:       c.id,
          title:    c.title,
          started:  c.created_at,
          model:    c.code_type,
          messages: []
        }];
      }

      if (live) {
        setChats(shaped);
        setCurrent(shaped[0].id);
      }
    }).finally(() => { if (live) setLC(false); });

    return () => { live = false; };
  }, [settings.codeType]);

  /* ─────────── LOAD messages for the active chat ─────────── */
  useEffect(() => {
    if (!currentChatId) return;
    let live = true;

    fetchMessages(currentChatId)
      .then(msgs => {
        if (!live) return;
        setChats(cs => cs.map(c =>
          c.id === currentChatId ? { ...c, messages: msgs } : c
        ));
      })
      .catch(err => safeAlert('Failed to fetch messages: ' + err.message));

    return () => { live = false; };
  }, [currentChatId]);

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] };

  /* ─────────── nav-rail scroll helpers ─────────── */
  const chatBoxRef = useRef(null);

  const scrollToPrev = () => {
    const box  = chatBoxRef.current;
    if (!box) return;

    const msgs = Array.from(box.querySelectorAll('.message'));
    if (msgs.length === 0) return;

    const curTop = box.scrollTop;
    let target   = null;

    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].offsetTop < curTop - 1) {
        target = msgs[i];
        break;
      }
    }
    box.scrollTop = target ? target.offsetTop : 0;
  };

  const scrollToNext = () => {
    const box  = chatBoxRef.current;
    if (!box) return;

    const msgs = Array.from(box.querySelectorAll('.message'));
    if (msgs.length === 0) return;

    const curTop = box.scrollTop;
    let target   = null;

    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].offsetTop > curTop + 1) {
        target = msgs[i];
        break;
      }
    }
    box.scrollTop = target ? target.offsetTop : box.scrollHeight;
  };

  /* =================================================================
     Business-logic helpers (send / edit / delete / undo)
     These are copied verbatim from your original file, only whitespace
     touched where ESLint yelled.
  ================================================================== */

  /* ---------- buildUserPrompt ---------- */
  function buildUserPrompt() {
    if (mode === 'DEVELOP') {
      const lines = ['MODE: DEVELOP'];
      if (form.developGoal.trim())         lines.push(`GOAL: ${form.developGoal.trim()}`);
      if (form.developFeatures.trim())     lines.push(`FEATURES: ${form.developFeatures.trim()}`);
      if (form.developReturnFormat.trim()) lines.push(`RETURN FORMAT: ${form.developReturnFormat.trim()}`);
      if (form.developWarnings.trim())     lines.push(`THINGS TO REMEMBER/WARNINGS: ${form.developWarnings.trim()}`);
      if (form.developContext.trim())      lines.push(`CONTEXT: ${form.developContext.trim()}`);
      return lines.join('\n');
    }
    if (mode === 'COMMIT')     return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (mode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    return '';
  }

  /* ---------- resetForm ---------- */
  function resetForm() {
    pendingImages.forEach(revokeOnce);
    setForm({
      developGoal:         '',
      developFeatures:     '',
      developReturnFormat: '',
      developWarnings:     '',
      developContext:      '',
      fixCode:             '',
      fixErrors:           ''
    });
    setPendingImages([]);
  }

  /* ---------- copy entire conversation ---------- */
  function handleCopyAll() {
    const txt = currentChat.messages.map(m =>
      Array.isArray(m.content)
        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : String(m.content)
    ).join('\n\n');

    navigator.clipboard.writeText(txt)
      .catch(() => safeAlert('Copy failed (clipboard API)'));
  }

  /* ---------- handleSend ---------- */
  function handleSend() {
    if (loadingSend) return;
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      safeAlert('GOAL is required for DEVELOP mode.');
      return;
    }

    runTask(async () => {
      /* 1) build prompt and insert USER row */
      const prompt  = buildUserPrompt();
      const userRow = await createMessage({
        chat_id: currentChatId,
        role:    'user',
        content: [{ type: 'text', text: prompt }]
      });

      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, userRow] }
          : c
      ));

      /* 2) re-fetch for safety */
      const fresh = await fetchMessages(currentChatId);
      const msgs  = [...fresh];

      /* 3) inject any pending images into the last user row */
      const lastIdx = msgs.length - 1;
      if (pendingImages.length && msgs[lastIdx]?.role === 'user') {
        async function convert(img) {
          const blob = await fetch(img.url).then(r => r.blob());
          const dataUrl = await new Promise(res => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result);
            fr.readAsDataURL(blob);
          });
          revokeOnce(img);
          return { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } };
        }
        const imageBlocks = await Promise.all(pendingImages.map(convert));
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          content: [...imageBlocks, { type: 'text', text: prompt }]
        };
      }

      /* 4) call LLM */
      const { content, error } = await callApiForText({
        apiKey:   settings.apiKey,
        model:    settings.model,
        messages: msgs
      });

      /* 5) insert ASSISTANT reply */
      const asstRow = await createMessage({
        chat_id: currentChatId,
        role:    'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });

      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, asstRow] }
          : c
      ));

      resetForm();
    });
  }

  /* ---------- editing helpers ---------- */
  function handleStartEdit(msg) {
    setEditing(msg.id);
    const txt = Array.isArray(msg.content)
      ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : String(msg.content);
    setEditText(txt);
  }

  function handleCancelEdit() {
    setEditing(null);
    setEditText('');
  }

  async function handleSaveEdit() {
    if (!editingId || loadingSend || savingEdit) return;
    setSaving(true);

    runTask(async () => {
      /* 1) fetch fresh msgs */
      let msgs = await fetchMessages(currentChatId);
      const idx = msgs.findIndex(x => x.id === editingId);
      if (idx === -1) throw new Error('Message not found for editing');

      /* 2) update DB */
      await updateMessage(editingId, editText);
      msgs[idx] = {
        ...msgs[idx],
        content: [{ type: 'text', text: editText }]
      };

      /* 3) archive everything after */
      await archiveMessagesAfter(currentChatId, msgs[idx].created_at);

      /* 4) call LLM with trimmed list */
      const trimmed              = msgs.slice(0, idx + 1);
      const { content, error }   = await callApiForText({
        apiKey:   settings.apiKey,
        model:    settings.model,
        messages: trimmed
      });

      /* 5) store assistant row */
      await createMessage({
        chat_id: currentChatId,
        role:    'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });

      /* 6) refresh */
      const updated = await fetchMessages(currentChatId);
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: updated } : c
      ));
      setEditing(null);
      setEditText('');
    }).finally(() => setSaving(false));
  }

  function handleResendMessage(id) {
    if (loadingSend) return;

    runTask(async () => {
      /* 1) get latest msgs and find anchor */
      const msgs   = await fetchMessages(currentChatId);
      const anchor = msgs.find(x => x.id === id);
      if (!anchor) throw new Error('Message not found');

      /* 2) archive newer ones */
      await archiveMessagesAfter(currentChatId, anchor.created_at);

      /* 3) re-fetch trimmed list */
      const trimmed = await fetchMessages(currentChatId);

      /* 4) call API again */
      const { content, error } = await callApiForText({
        apiKey:   settings.apiKey,
        model:    settings.model,
        messages: trimmed
      });

      /* 5) add assistant reply */
      const asst = await createMessage({
        chat_id: currentChatId,
        role:    'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });

      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...trimmed, asst] }
          : c
      ));

      /* 6) toast w/ undo */
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

  /* ---------- chat CRUD ---------- */
  function handleNewChat() {
    if (loadingSend) return;

    runTask(async () => {
      const c = await createChat({ title: 'New Chat', model: settings.codeType });
      setChats(cs => [{
        id:       c.id,
        title:    c.title,
        started:  c.created_at,
        model:    c.code_type,
        messages: []
      }, ...cs]);
      setCurrent(c.id);
    });
  }

  async function handleRenameChat(id, newTitle) {
    setChats(cs => cs.map(c => c.id === id ? { ...c, title: newTitle } : c));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      safeAlert('Rename failed: ' + err.message);
      /* reload list from DB */
      const rows = await fetchChats();
      const shaped = rows.map(r => ({
        id:       r.id,
        title:    r.title,
        started:  r.created_at,
        model:    r.code_type,
        messages: []
      }));
      setChats(shaped);
    }
  }

  function handleDeleteChatUI(id) {
    if (loadingSend) return;

    const anchorId = currentChatId;
    runTask(() =>
      undoableDelete({
        itemLabel: 'Chat',
        deleteFn:  () => deleteChat(id),
        undoFn:    () => runTask(async () => {
          await undoDeleteChat(id);
          const rows = await fetchChats();
          const shaped = rows.map(r => ({
            id:       r.id,
            title:    r.title,
            started:  r.created_at,
            model:    r.code_type,
            messages: []
          }));
          setChats(shaped);
          const found = shaped.find(c => c.id === id);
          setCurrent(found ? found.id : shaped[0]?.id ?? null);
        }),
        afterDelete: () => {
          setChats(cs => {
            const filtered = cs.filter(x => x.id !== id);
            if (anchorId === id) {
              if (filtered.length) setCurrent(filtered[0].id);
              else setCurrent(null);
            }
            return filtered;
          });
        }
      })
    );
  }

  function handleDeleteMessage(id) {
    if (id === editingId) {
      setEditing(null);
      setEditText('');
    }
    if (loadingSend) return;

    const anchorId = currentChatId;
    runTask(() =>
      undoableDelete({
        itemLabel: 'Message',
        deleteFn:  () => deleteMessage(id),
        undoFn:    () => runTask(async () => {
          await undoDeleteMessage(id);
          const msgs = await fetchMessages(anchorId);
          setChats(cs => cs.map(c =>
            c.id === anchorId ? { ...c, messages: msgs } : c
          ));
        }),
        afterDelete: () => {
          setChats(cs => cs.map(c =>
            c.id === anchorId
              ? { ...c, messages: c.messages.filter(m => m.id !== id) }
              : c
          ));
        }
      })
    );
  }

  /* ============================================================== */
  /*                              UI                                */
  /* ============================================================== */
  if (loadingChats) {
    return (
      <h2 style={{ textAlign: 'center', marginTop: '20vh' }}>
        Loading…
      </h2>
    );
  }

  return (
    <div className="app-container">
      {/* ────────── sidebar (chat list) ────────── */}
      <ChatPane
        chats          ={chats}
        currentChatId  ={currentChatId}
        onSelectChat   ={setCurrent}
        onNewChat      ={handleNewChat}
        onTitleUpdate  ={handleRenameChat}
        onDeleteChat   ={handleDeleteChatUI}
        disabled       ={loadingSend}
      />

      {/* ────────── main column ────────── */}
      <div className="main-content">
        {/* top bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>

          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>konzuko-code</span>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5em' }}>
            <div style={{ padding: '4px 12px', background: '#4f8eff', borderRadius: 4 }}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>
              Copy All Text
            </button>
          </div>
        </div>

        {/* user settings panel (unchanged) */}
        {settings.showSettings && (
          <div
            className="settings-panel"
            style={{ padding: '1em', borderBottom: '1px solid var(--border)' }}
          >
            <div className="form-group">
              <label>OpenAI API Key:</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>Model:</label>
              <select
                className="form-select"
                value={settings.model}
                onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
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

        <div className="content-container" style={{ display: 'flex', flex: 1 }}>
          {/* ───── chat (memoised) ───── */}
          <div className="chat-container" ref={chatBoxRef}>
            {/* nav-rail */}
            <div className="chat-nav-rail">
              <button
                className="button icon-button"
                onClick={scrollToPrev}
                title="Scroll to previous message"
              >
                ↑
              </button>
              <button
                className="button icon-button"
                onClick={scrollToNext}
                title="Scroll to next message"
              >
                ↓
              </button>
            </div>

            {/* ChatArea → no re-render on keystrokes */}
            <ChatArea
              messages           ={currentChat.messages}
              editingId          ={editingId}
              editText           ={editText}
              loadingSend        ={loadingSend}
              savingEdit         ={savingEdit}
              setEditText        ={setEditText}
              handleSaveEdit     ={handleSaveEdit}
              handleCancelEdit   ={handleCancelEdit}
              handleStartEdit    ={handleStartEdit}
              handleResendMessage={handleResendMessage}
              handleDeleteMessage={handleDeleteMessage}
            />
          </div>

          {/* ───── prompt builder ───── */}
          <div style={{
            width: '50%',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto'
          }}>
            <PromptBuilder
              mode          ={mode}
              setMode       ={setMode}
              form          ={form}
              setForm       ={setForm}
              loadingSend   ={loadingSend}
              handleSend    ={handleSend}
              showToast     ={showToast}
              onImageDrop   ={setPendingImages}
              onRemoveImage ={i => {
                setPendingImages(a => {
                  revokeOnce(a[i]);
                  return a.filter((_, j) => j !== i);
                });
              }}
              imagePreviews ={pendingImages}
            />
          </div>
        </div>
      </div>

      {/* toast (undo) */}
      {toast && (
        <Toast
          text    ={toast.text}
          onAction={toast.onUndo}
          onClose ={() => setToast(null)}
        />
      )}
    </div>
  );
}
