import { useState, useEffect, useCallback } from 'preact/hooks';
import ChatPane        from './chatpane.jsx';
import Toast           from './components/Toast.jsx';
import PromptBuilder   from './PromptBuilder.jsx';
import FilePane        from './FilePane.jsx';

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
  const [chats, setChats]           = useState([]);
  const [currentChatId, setCurrent] = useState(null);
  const [loadingChats, setLC]       = useState(true);
  const [loadingSend, setLS]        = useState(false);
  const [editingId, setEditing]     = useState(null);
  const [toast, setToast]           = useState(null);

  const [settings, setSettings] = useSettings();
  const [form, setForm]         = useFormData();  // Shared state across app
  const [mode, setMode]         = useMode();

  // In-memory images
  const [pendingImages, setPendingImages] = useState([]); // { name, url }[]

  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  );

  const showToast      = useCallback((text, onUndo) => setToast({ text, onUndo }), []);
  const undoableDelete = useUndoableDelete(showToast);

  // ─────────────────────────────────────────────────────────────────────────
  // Load Chat list
  // ─────────────────────────────────────────────────────────────────────────
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
        alert('Failed to load chats: ' + err.message);
      } finally {
        alive && setLC(false);
      }
    })();
    return () => { alive = false; };
  }, [settings.codeType]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load messages for the current chat
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
      .catch(err => alert('Failed to fetch messages: ' + err.message));
    return () => { alive = false; };
  }, [currentChatId]);

  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] };

  // ─────────────────────────────────────────────────────────────────────────
  // Build or reset user prompt
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
    if (mode === 'COMMIT')   return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (mode === 'DIAGNOSE') return 'MODE: DIAGNOSE\nPlease analyze any errors or pitfalls.';
    return '';
  }

  function resetForm() {
    setForm({
      developGoal        : '',
      developFeatures    : '',
      developReturnFormat: '',
      developWarnings    : '',
      developContext     : '',
      fixCode            : '',
      fixErrors          : ''
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat CRUD
  // ─────────────────────────────────────────────────────────────────────────
  async function handleNewChat() {
    setLS(true);
    try {
      const c = await createChat({ title: 'New Chat', model: settings.codeType });
      setChats(cs => [{
        id      : c.id,
        title   : c.title,
        started : c.created_at,
        model   : c.code_type,
        messages: []
      }, ...cs]);
      setCurrent(c.id);
    } catch (err) {
      alert('Failed to create chat: ' + err.message);
    } finally {
      setLS(false);
    }
  }

  async function handleRenameChat(id, newTitle) {
    setChats(cs => cs.map(c => (c.id === id ? { ...c, title: newTitle } : c)));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      alert('Rename failed: ' + err.message);
      // rollback
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

  // ─────────────────────────────────────────────────────────────────────────
  // Message CRUD
  // ─────────────────────────────────────────────────────────────────────────
  function handleDeleteMessage(id) {
    undoableDelete({
      itemLabel  : 'Message',
      deleteFn   : () => deleteMessage(id),
      undoFn     : async () => {
        await undoDeleteMessage(id);
        const msgs = await fetchMessages(currentChatId);
        setChats(cs => cs.map(c => c.id === currentChatId ? { ...c, messages: msgs } : c));
      },
      afterDelete: () => setChats(cs =>
        cs.map(c =>
          c.id === currentChatId
            ? { ...c, messages: c.messages.filter(m => m.id !== id) }
            : c
        )
      )
    });
  }

  function handleDeleteChatUI(id) {
    undoableDelete({
      itemLabel  : 'Chat',
      deleteFn   : () => deleteChat(id),
      undoFn     : async () => {
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
        setCurrent(id);
        const msgs = await fetchMessages(id);
        setChats(cs => cs.map(c => c.id === id ? { ...c, messages: msgs } : c));
      },
      afterDelete: () => setChats(cs => {
        const filtered = cs.filter(c => c.id !== id);
        if (currentChatId === id) setCurrent(filtered[0]?.id ?? null);
        return filtered;
      })
    });
  }

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
  // MAIN SEND
  // ─────────────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!currentChatId) return;
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      alert('GOAL is required for DEVELOP mode.');
      return;
    }

    setLS(true);
    try {
      // 1) Combine images + user prompt
      const parts = [
        ...pendingImages.map(img => ({
          type: 'image_url',
          image_url: { url: img.url, detail: 'auto' }
        })),
        { type: 'text', text: buildUserPrompt() }
      ];

      // 2) Save the user's message
      await createMessage({
        chat_id: currentChatId,
        role   : 'user',
        content: parts
      });

      // 3) Reset local form & images
      setPendingImages([]);
      resetForm();

      // 4) Reload messages
      const msgs = await fetchMessages(currentChatId);

      // 5) Call model
      const { content, error } = await callApiForText({
        apiKey  : settings.apiKey,
        model   : settings.model,
        messages: msgs
      });

      // 6) Save assistant response
      const assistantMsg = await createMessage({
        chat_id: currentChatId,
        role   : 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });

      // 7) Update local state
      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...msgs, assistantMsg] }
          : c
      ));
    }
    catch (err) {
      alert('Send failed: ' + err.message);
    }
    finally {
      setLS(false);
    }
  }

  if (loadingChats) {
    return (
      <h2 style={{ textAlign:'center', marginTop:'20vh' }}>
        Loading…
      </h2>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={setCurrent}
        onTitleUpdate={handleRenameChat}
        onDeleteChat={handleDeleteChatUI}
      />

      <div className="main-content">
        {/* Top bar */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin:'0 1em', fontWeight:'bold' }}>
            konzuko-code
          </span>
          <select
            value={settings.codeType}
            onChange={e => setSettings(s => ({ ...s, codeType:e.target.value }))}
            style={{ marginRight:'1em' }}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="hugo">Hugo</option>
            <option value="go">Go</option>
          </select>
          <div style={{
            marginLeft:'auto',
            padding:'4px 12px',
            background:'#4f8eff',
            borderRadius:4
          }}>
            Tokens: {tokenCount.toLocaleString()}
          </div>
        </div>

        {/* Settings panel */}
        {settings.showSettings && (
          <div className="settings-panel">
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
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                <option value="o3-2025-04-16">o3-2025-04-16</option>
              </select>
            </div>
          </div>
        )}

        {/* Main content: chat left, files + prompt right */}
        <div className="content-container" style={{ display:'flex' }}>
          {/* Left: chat messages */}
          <div className="chat-container">
            {currentChat.messages.map((m, idx) => {
              const isAssistant = m.role === 'assistant';
              const copyFull = () => {
                let text = '';
                if (Array.isArray(m.content)) {
                  text = m.content.map(c => c.type === 'text' ? c.text : '').join('');
                } else {
                  text = String(m.content);
                }
                navigator.clipboard.writeText(text);
              };

              return (
                <div key={m.id} className={`message message-${m.role}`}>
                  {isAssistant && (
                    <div className="floating-controls">
                      <button
                        className="button icon-button"
                        onClick={copyFull}
                      >
                        📋
                      </button>
                    </div>
                  )}
                  <div className="message-header">
                    <span className="message-role">
                      {isAssistant ? `${idx} assistant` : m.role}
                    </span>
                    <div className="message-actions">
                      <button className="button icon-button" onClick={copyFull}>
                        Copy
                      </button>
                      {m.role === 'user' && (
                        <button
                          className="button icon-button"
                          onClick={() => {
                            setEditing(m.id);
                            const txt = Array.isArray(m.content)
                              ? m.content.map(c => c.type === 'text' ? c.text : '').join('')
                              : String(m.content);
                            setForm(f => ({ ...f, developGoal: txt }));
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        className="button icon-button"
                        onClick={() => handleDeleteMessage(m.id)}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                  <div className="message-content">
                    {Array.isArray(m.content)
                      ? m.content.map((c, j) => (
                          c.type === 'text'
                            ? <div key={j}>{c.text}</div>
                            : <img
                                key={j}
                                src={c.image_url.url}
                                alt="img"
                                style={{ maxWidth:200, margin:'8px 0' }}
                              />
                        ))
                      : <div style={{ whiteSpace:'pre-wrap' }}>{m.content}</div>
                    }
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: file panel + prompt builder */}
          <div style={{ flex:'1', display:'flex', flexDirection:'column' }}>
            <FilePane form={form} setForm={setForm} />

            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={loadingSend}
              editingId={editingId}
              handleSend={handleSend}
              handleCopyAll={handleCopyAll}
              onImageDrop={(name, url) =>
                setPendingImages(a => [...a, { name, url }])
              }
              onRemoveImage={i => setPendingImages(a => a.filter((_, j) => j !== i))}
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