
import { useState, useEffect, useCallback } from 'preact/hooks';
import ChatPane        from './chatpane.jsx';
import Toast           from './components/Toast.jsx';
import PromptBuilder   from './PromptBuilder.jsx';

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
  updateChatTitle,
  undoArchiveMessagesAfter
} from './api.js';

import {
  useSettings,
  useFormData,
  useMode,
  useTokenCount,
  useUndoableDelete
} from './hooks.js';

import { queue } from './lib/TaskQueue.js';

/* ---------------------------------------------------------
   Single global runTask + queueSetLS for loading states
   safeAlert for blocked alert fallback
---------------------------------------------------------*/
let queueSetLS = () => {};
function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.error('Alert blocked, fallback console error:', msg, e);
  }
}

function runTask(taskFn) {
  queueSetLS(true);
  return queue
    .push(taskFn)
    .catch(err => safeAlert(err?.message ?? 'Unknown error'))
    .finally(() => queueSetLS(false));
}

export default function App() {
  const [chats, setChats]           = useState([]);
  const [currentChatId, setCurrent] = useState(null);
  const [loadingChats, setLC]       = useState(true);
  const [loadingSend, setLS]        = useState(false);

  // inline editing
  const [editingId, setEditing]     = useState(null);
  const [editText,  setEditText]    = useState('');

  const [toast, setToast]          = useState(null);

  const [settings, setSettings]    = useSettings();
  const [form,     setForm]        = useFormData();
  const [mode,     setMode]        = useMode();

  const [pendingImages, setPendingImages] = useState([]);

  const tokenCount     = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  );
  const showToast      = useCallback((text, onUndo) => setToast({ text, onUndo }), []);
  const undoableDelete = useUndoableDelete(showToast);

  // Keep runTask’s loading state in sync with our setLS
  useEffect(() => {
    queueSetLS = setLS;
  }, [setLS]);

  // Clear edit state when switching chats
  useEffect(() => {
    setEditing(null);
    setEditText('');
  }, [currentChatId]);

  // ─────────────────────────────────────────────────────────────────────────
  // 1) Load chats
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    runTask(async () => {
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
        // If user has zero chats, create one
        if (!shaped.length) {
          const c = await createChat({ title: 'New Chat', model: settings.codeType });
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
      } catch (err) {
        safeAlert('Failed to load chats: ' + err.message);
      } finally {
        if (alive) setLC(false);
      }
    });
    return () => { alive = false; };
  }, [settings.codeType, safeAlert, runTask]);

  // ─────────────────────────────────────────────────────────────────────────
  // 2) Load messages for current chat
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentChatId) return;
    let alive = true;
    fetchMessages(currentChatId)
      .then(msgs => {
        if (!alive) return;
        setChats(cs =>
          cs.map(c => (c.id === currentChatId ? { ...c, messages: msgs } : c))
        );
      })
      .catch(err => safeAlert('Failed to fetch messages: ' + err.message));
    return () => { alive = false; };
  }, [currentChatId, safeAlert]);

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] };

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: build user prompt string
  // ─────────────────────────────────────────────────────────────────────────
  function buildUserPrompt() {
    if (mode === 'DEVELOP') {
      return `
MODE: DEVELOP
GOAL: ${form.developGoal}
FEATURES: ${form.developFeatures}
RETURN FORMAT: ${form.developReturnFormat}
THINGS TO REMEMBER/WARNINGS: ${form.developWarnings}
CONTEXT: ${form.developContext}`.trim();
    }
    if (mode === 'COMMIT') {
      return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    }
    if (mode === 'DIAGNOSE') {
      return 'MODE: DIAGNOSE\nPlease analyze any errors or pitfalls.';
    }
    return '';
  }

  function resetForm() {
    setForm({
      developGoal         : '',
      developFeatures     : '',
      developReturnFormat : '',
      developWarnings     : '',
      developContext      : '',
      fixCode             : '',
      fixErrors           : ''
    });
    setPendingImages([]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat creation & deletion
  // ─────────────────────────────────────────────────────────────────────────
  function handleNewChat() {
    if (loadingSend) return;
    runTask(async () => {
      const c = await createChat({ title: 'New Chat', model: settings.codeType });
      setEditing(null);
      setChats(cs => [{
        id      : c.id,
        title   : c.title,
        started : c.created_at,
        model   : c.code_type,
        messages: []
      }, ...cs]);
      setCurrent(c.id);
    });
  }

  async function handleRenameChat(id, newTitle) {
    // rename is typically quick, no queue needed
    setChats(cs => cs.map(c => c.id === id ? { ...c, title: newTitle } : c));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      safeAlert('Rename failed: ' + err.message);
      // reload from DB on failure
      const rows = await fetchChats();
      setChats(rows.map(r => ({
        id      : r.id,
        title   : r.title,
        started : r.created_at,
        model   : r.code_type,
        messages: []
      })));
    }
  }

  function handleDeleteChatUI(id) {
    if (loadingSend) return;
    const anchorChatId = currentChatId; // store for closure
    runTask(() =>
      undoableDelete({
        itemLabel: 'Chat',
        deleteFn: () => deleteChat(id),
        // Wrap undo in runTask
        undoFn: () => runTask(async () => {
          await undoDeleteChat(id);
          const rows = await fetchChats();
          const shaped = rows.map(r => ({
            id      : r.id,
            title   : r.title,
            started : r.created_at,
            model   : r.code_type,
            messages: []
          }));
          setChats(shaped);
          // Focus back on this chat if still present
          if (shaped.some(c => c.id === id)) {
            setCurrent(id);
          } else {
            // If it's truly back, but older than top, we maybe pick shaped[0]
            setCurrent(shaped[0]?.id ?? null);
          }
        }),
        afterDelete: () => setChats(cs => {
          const filtered = cs.filter(c => c.id !== id);
          // If we just removed the currently open chat, pick next
          if (anchorChatId === id) {
            return filtered.length
              ? (setCurrent(filtered[0].id), filtered)
              : (setCurrent(null), filtered);
          }
          return filtered;
        })
      })
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Deletion
  // ─────────────────────────────────────────────────────────────────────────
  function handleDeleteMessage(id) {
    if (id === editingId) {
      setEditing(null);
      setEditText('');
    }
    if (loadingSend) return;
    const anchorChatId = currentChatId; // store in case user changes chat
    runTask(() =>
      undoableDelete({
        itemLabel: 'Message',
        deleteFn: () => deleteMessage(id),
        // wrap in runTask to ensure loading & error handling
        undoFn: () => runTask(async () => {
          await undoDeleteMessage(id);
          const msgs = await fetchMessages(anchorChatId);
          setChats(cs =>
            cs.map(c =>
              c.id === anchorChatId
                ? { ...c, messages: msgs }
                : c
            )
          );
        }),
        afterDelete: () => setChats(cs =>
          cs.map(c =>
            c.id === anchorChatId
              ? { ...c, messages: c.messages.filter(m => m.id !== id) }
              : c
          )
        )
      })
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Inline EDIT
  // ─────────────────────────────────────────────────────────────────────────
  function handleStartEdit(m) {
    if (loadingSend) return;
    setEditing(m.id);
    const raw = Array.isArray(m.content)
      ? m.content.filter(c => c.type === 'text').map(c => c.text).join('')
      : String(m.content);
    setEditText(raw);
  }

  function handleCancelEdit() {
    setEditing(null);
    setEditText('');
  }

  function handleSaveEdit() {
    if (!editingId || loadingSend) return;
    const anchorChatId = currentChatId;
    runTask(async () => {
      const cObj = chats.find(c => c.id === anchorChatId);
      if (!cObj) throw new Error('Chat not found');
      const anchor = cObj.messages.find(x => x.id === editingId);
      if (!anchor) throw new Error('Message not found for editing');

      // 1) Update the existing message
      await updateMessage(editingId, editText);

      // 2) Archive anything after
      await archiveMessagesAfter(anchorChatId, anchor.created_at);

      // 3) Re-fetch + LLM
      const msgs = await fetchMessages(anchorChatId);
      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      });

      // 4) Insert new assistant
      const assistantMsg = await createMessage({
        chat_id: anchorChatId,
        role   : 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });
      const newAssistantId = assistantMsg.id;

      // 5) Local update
      setChats(cs =>
        cs.map(c =>
          c.id === anchorChatId
            ? { ...c, messages: [...msgs, assistantMsg] }
            : c
        )
      );

      // 6) Toast with full revert
      showToast('Archived messages. Undo?', () =>
        runTask(async () => {
          await undoArchiveMessagesAfter(anchorChatId, anchor.created_at);
          await deleteMessage(newAssistantId);

          const undone = await fetchMessages(anchorChatId);
          setChats(cs =>
            cs.map(cc =>
              cc.id === anchorChatId
                ? { ...cc, messages: undone }
                : cc
            )
          );
        })
      );

      // 7) Cleanup
      setEditing(null);
      setEditText('');
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resend
  // ─────────────────────────────────────────────────────────────────────────
  function handleResendMessage(id) {
    if (loadingSend) return;
    const anchorChatId = currentChatId;
    runTask(async () => {
      const cObj = chats.find(c => c.id === anchorChatId);
      if (!cObj) throw new Error('Chat not found');
      const anchor = cObj.messages.find(x => x.id === id);
      if (!anchor) throw new Error('Message not found');

      // 1) Archive everything after anchor
      await archiveMessagesAfter(anchorChatId, anchor.created_at);

      // 2) Re-fetch
      const msgs = await fetchMessages(anchorChatId);

      // 3) LLM
      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      });

      // 4) new assistant
      const assistantMsg = await createMessage({
        chat_id: anchorChatId,
        role   : 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });
      const newAssistantId = assistantMsg.id;

      // 5) local update
      setChats(cs =>
        cs.map(c =>
          c.id === anchorChatId
            ? { ...c, messages: [...msgs, assistantMsg] }
            : c
        )
      );

      // 6) Undo toast
      showToast('Archived messages. Undo?', () =>
        runTask(async () => {
          await undoArchiveMessagesAfter(anchorChatId, anchor.created_at);
          await deleteMessage(newAssistantId);

          const undone = await fetchMessages(anchorChatId);
          setChats(cs =>
            cs.map(cc =>
              cc.id === anchorChatId
                ? { ...cc, messages: undone }
                : cc
            )
          );
        })
      );
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN SEND from PromptBuilder
  // ─────────────────────────────────────────────────────────────────────────
  function handleSend() {
    if (loadingSend) return;
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      safeAlert('GOAL is required for DEVELOP mode.');
      return;
    }

    const anchorChatId = currentChatId;
    runTask(async () => {
      const parts = [
        ...pendingImages.map(img => ({
          type: 'image_url',
          image_url: { url: img.url, detail: 'auto' }
        })),
        { type: 'text', text: buildUserPrompt() }
      ];

      // user message
      await createMessage({
        chat_id: anchorChatId,
        role   : 'user',
        content: parts
      });

      // re-fetch + LLM
      const msgs = await fetchMessages(anchorChatId);
      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      });

      // new assistant
      const assistantMsg = await createMessage({
        chat_id: anchorChatId,
        role   : 'assistant',
        content: [{ type:'text', text: error ? `Error: ${error}` : content }]
      });

      // local update + reset form
      setChats(cs =>
        cs.map(c =>
          c.id === anchorChatId ? { ...c, messages: [...msgs, assistantMsg] } : c
        )
      );
      resetForm();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COPY ALL
  // ─────────────────────────────────────────────────────────────────────────
  function handleCopyAll() {
    const txt = currentChat.messages
      .map(m =>
        Array.isArray(m.content)
          ? m.content.map(c => (c.type === 'text' ? c.text : '')).join('')
          : String(m.content)
      )
      .join('\n\n');
    navigator.clipboard.writeText(txt);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (loadingChats) {
    return <h2 style={{ textAlign:'center', marginTop:'20vh' }}>Loading…</h2>;
  }

  return (
    <div className="app-container">
      <ChatPane
        chats         ={chats}
        currentChatId ={currentChatId}
        onSelectChat  ={setCurrent}
        onNewChat     ={handleNewChat}
        onTitleUpdate ={handleRenameChat}
        onDeleteChat  ={handleDeleteChatUI}
        disabled      ={loadingSend /* block chat switch mid-task */}
      />

      <div className="main-content">
        {/* top bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin:'0 1em', fontWeight:'bold' }}>konzuko-code</span>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'0.5em' }}>
            <div style={{ padding:'4px 12px', background:'#4f8eff', borderRadius:4 }}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>
              Copy All Text
            </button>
          </div>
        </div>

        {settings.showSettings && (
          <div className="settings-panel">
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
                <option value="o4-mini-2025-04-16">o4-mini-2025-04-16 (default)</option>
                <option value="o1">o1</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
                <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27</option>
              </select>
            </div>
          </div>
        )}

        <div className="content-container" style={{ display:'flex' }}>
          {/* Chat area */}
          <div className="chat-container">
            {currentChat.messages.map((m, idx) => {
              const isAssistant = (m.role === 'assistant');

              const copyFull = () => {
                let txt = '';
                if (Array.isArray(m.content)) {
                  txt = m.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('');
                } else {
                  txt = String(m.content);
                }
                navigator.clipboard.writeText(txt);
              };

              const isLastUser =
                m.role === 'user' &&
                idx === currentChat.messages.length - 1 &&
                !editingId;

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
                      {isAssistant ? idx + ' assistant' : m.role}
                    </span>
                    <div className="message-actions">
                      {m.id === editingId ? (
                        <>
                          <button
                            className="button"
                            disabled={loadingSend}
                            onClick={handleSaveEdit}
                          >
                            Save
                          </button>
                          <button
                            className="button"
                            disabled={loadingSend}
                            onClick={handleCancelEdit}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="button icon-button" onClick={copyFull}>
                            Copy
                          </button>
                          {isLastUser && (
                            <>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={() => handleStartEdit(m)}
                              >
                                Edit
                              </button>
                              <button
                                className="button icon-button"
                                disabled={loadingSend}
                                onClick={() => handleResendMessage(m.id)}
                              >
                                Resend
                              </button>
                            </>
                          )}
                          <button
                            className="button icon-button"
                            onClick={() => handleDeleteMessage(m.id)}
                            disabled={loadingSend}
                          >
                            Del
                          </button>
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
                        onInput={e => setEditText(e.target.value)}
                      />
                    ) : Array.isArray(m.content) ? (
                      m.content.map((c, j) =>
                        c.type === 'text'
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

          {/* Right side: PromptBuilder */}
          <div style={{ flex:'1', display:'flex', flexDirection:'column' }}>
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={loadingSend}
              handleSend={handleSend}
              handleCopyAll={handleCopyAll}
              onImageDrop={(name, url) =>
                setPendingImages(a => [...a, { name, url }])
              }
              onRemoveImage={i =>
                setPendingImages(a => a.filter((_, j) => j !== i))
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
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}