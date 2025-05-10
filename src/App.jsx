import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
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

// Fallback alert if blocked
function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.error('alert blocked', msg, e);
  }
}

// We'll toggle this to show/hide loading while tasks run
let queueSetLoading = () => {};

/**
 * Enqueue an async function so we can show loadingSend while it runs.
 */
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

// (NEW) We import the full MarkdownRenderer instead of renderWithCodeButtons
import MarkdownRenderer from './components/MarkdownRenderer.jsx';

/** Revoke an image blob URL exactly once. */
function revokeOnce(img) {
  if (img?.revoke) {
    img.revoke();
    img.revoke = null;
  }
}

export default function App() {
  // ─────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────
  const [chats,         setChats]         = useState([]);
  const [currentChatId, setCurrent]       = useState(null);
  const [loadingChats,  setLC]            = useState(true);
  const [loadingSend,   setLoadingSend]   = useState(false);

  const [editingId,     setEditing]       = useState(null);
  const [editText,      setEditText]      = useState('');
  const [savingEdit,    setSaving]        = useState(false);

  const [toast,         setToast]         = useState(null);
  const [pendingImages, setPendingImages] = useState([]);

  // config & user input states
  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  // token count in the current chat
  const tokenCount = useTokenCount(
    chats.find(c => c.id === currentChatId)?.messages ?? [],
    settings.model
  );

  // ephemeral toast
  const showToast      = useCallback((text, onUndo) => setToast({ text, onUndo }), []);
  const undoableDelete = useUndoableDelete(showToast);

  // a ref to the scrollable chat pane
  const chatContainerRef = useRef(null);

  // ─────────────────────────────────────────────────────────────
  // NAV-RAIL SCROLL LOGIC: scrollToPrev / scrollToNext
  // ─────────────────────────────────────────────────────────────
  function scrollToPrev() {
    const box = chatContainerRef.current;
    if (!box) return;

    const msgs = Array.from(box.querySelectorAll('.message'));
    if (!msgs.length) return;

    const curTop = box.scrollTop;
    let target   = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].offsetTop < curTop - 1) {
        target = msgs[i];
        break;
      }
    }
    box.scrollTop = target ? target.offsetTop : 0;
  }

  function scrollToNext() {
    const box = chatContainerRef.current;
    if (!box) return;

    const msgs = Array.from(box.querySelectorAll('.message'));
    if (!msgs.length) return;

    const curTop = box.scrollTop;
    let target   = null;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].offsetTop > curTop + 1) {
        target = msgs[i];
        break;
      }
    }
    box.scrollTop = target ? target.offsetTop : box.scrollHeight;
  }

  // ─────────────────────────────────────────────────────────────
  // queue-runner setup
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    queueSetLoading = setLoadingSend;
  }, []);

  // ─────────────────────────────────────────────────────────────
  // When switching chats, discard unsent images from memory
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setPendingImages(prev => {
      prev.forEach(revokeOnce);
      return [];
    });
  }, [currentChatId]);

  // ─────────────────────────────────────────────────────────────
  // LOAD: fetch chat list exactly once
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    runTask(async () => {
      setLC(true);
      const rows = await fetchChats();

      let shaped = rows.map(r => ({
        id:      r.id,
        title:   r.title,
        started: r.created_at,
        model:   r.code_type,
        messages:[]
      }));

      if (!shaped.length) {
        const c = await createChat({ title: 'New Chat', model: settings.codeType });
        shaped = [{
          id:      c.id,
          title:   c.title,
          started: c.created_at,
          model:   c.code_type,
          messages:[]
        }];
      }

      if (alive) {
        setChats(shaped);
        setCurrent(shaped[0].id);
      }
    }).finally(() => {
      if (alive) setLC(false);
    });
    return () => {
      alive = false;
    };
  }, [settings.codeType]);

  // ─────────────────────────────────────────────────────────────
  // LOAD MESSAGES for the current chat
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentChatId) return;
    let live = true;
    fetchMessages(currentChatId)
      .then(msgs => {
        if (!live) return;
        setChats(cs => cs.map(c => c.id === currentChatId
          ? { ...c, messages: msgs }
          : c
        ));
      })
      .catch(err => safeAlert('Failed to fetch msgs: ' + err.message));
    return () => {
      live = false;
    };
  }, [currentChatId]);

  // currently active chat
  const currentChat = chats.find(c => c.id === currentChatId) ?? { messages: [] };

  // ─────────────────────────────────────────────────────────────
  // BUILD user prompt from form
  // ─────────────────────────────────────────────────────────────
  function buildUserPrompt() {
    if (mode === 'DEVELOP') {
      const lines = ['MODE: DEVELOP'];
      if (form.developGoal.trim()) {
        lines.push(`GOAL: ${form.developGoal.trim()}`);
      }
      if (form.developFeatures.trim()) {
        lines.push(`FEATURES: ${form.developFeatures.trim()}`);
      }
      if (form.developReturnFormat.trim()) {
        lines.push(`RETURN FORMAT: ${form.developReturnFormat.trim()}`);
      }
      if (form.developWarnings.trim()) {
        lines.push(`THINGS TO REMEMBER/WARNINGS: ${form.developWarnings.trim()}`);
      }
      if (form.developContext.trim()) {
        lines.push(`CONTEXT: ${form.developContext.trim()}`);
      }
      return lines.join('\n');
    }
    if (mode === 'COMMIT') {
      return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    }
    if (mode === 'CODE CHECK') {
      return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    }
    return '';
  }

  /**
   * After send, clear images + text fields
   */
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

  /**
   * Copy entire conversation text
   */
  function handleCopyAll() {
    const txt = currentChat.messages.map(m =>
      Array.isArray(m.content)
        ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : String(m.content)
    ).join('\n\n');
    navigator.clipboard.writeText(txt);
  }

  // ─────────────────────────────────────────────────────────────
  // handleSend
  // ─────────────────────────────────────────────────────────────
  function handleSend() {
    if (loadingSend) return;
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      safeAlert('GOAL is required for DEVELOP mode.');
      return;
    }
    runTask(async () => {
      // 1) build user prompt, create DB row
      const prompt = buildUserPrompt();
      const userRow = await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: [{ type: 'text', text: prompt }]
      });
      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, userRow] }
          : c
      ));

      // 2) re-fetch messages
      const freshMsg = await fetchMessages(currentChatId);
      let finalMsgs = [...freshMsg];

      // if last row is user, convert images -> dataURL blocks
      const lastIdx = finalMsgs.length - 1;
      const lastRow = finalMsgs[lastIdx];
      if (lastRow?.role === 'user') {
        async function convertImage(img) {
          const blob = await fetch(img.url).then(r => r.blob());
          const dataUrl = await new Promise(res => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result);
            fr.readAsDataURL(blob);
          });
          revokeOnce(img);
          return { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } };
        }
        const imageBlocks = await Promise.all(pendingImages.map(convertImage));
        finalMsgs[lastIdx] = {
          ...lastRow,
          content: [
            ...imageBlocks,
            { type: 'text', text: prompt }
          ]
        };
      }

      // 3) call LLM
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model:  settings.model,
        messages: finalMsgs
      });

      // 4) insert assistant row
      const asstRow = await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });
      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, asstRow] }
          : c
      ));

      // 5) reset form
      resetForm();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // handleSaveEdit
  // ─────────────────────────────────────────────────────────────
  function handleSaveEdit() {
    if (!editingId || loadingSend || savingEdit) return;
    setSaving(true);
    runTask(async () => {
      // 1) retrieve fresh messages
      let msgs = await fetchMessages(currentChatId);
      const idx = msgs.findIndex(x => x.id === editingId);
      if (idx === -1) throw new Error('Message not found for editing');

      // 2) update DB
      await updateMessage(editingId, editText);
      msgs[idx] = { ...msgs[idx], content: [{ type: 'text', text: editText }] };

      // 3) archive everything after
      await archiveMessagesAfter(currentChatId, msgs[idx].created_at);

      // 4) re-run from truncated
      const trimmed = msgs.slice(0, idx + 1);
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model:  settings.model,
        messages: trimmed
      });

      // 5) store assistant row
      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });

      // 6) fetch updated
      const updated = await fetchMessages(currentChatId);
      setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: updated } : c
      ));
      setEditing(null);
      setEditText('');
    }).finally(() => setSaving(false));
  }

  function handleCancelEdit() {
    setEditing(null);
    setEditText('');
  }

  /**
   * Re-run from after a user message but includes up to that anchor.
   */
  function handleResendMessage(id) {
    if (loadingSend) return;
    const anchorId = currentChatId;
    runTask(async () => {
      // 1) fetch latest
      const msgs = await fetchMessages(anchorId);
      const anchor = msgs.find(x => x.id === id);
      if (!anchor) throw new Error('Message not found');

      // 2) archive everything after
      await archiveMessagesAfter(anchorId, anchor.created_at);

      // 3) now re-fetch truncated
      const trimmed = await fetchMessages(anchorId);

      // 4) call LLM
      const { content, error } = await callApiForText({
        apiKey: settings.apiKey,
        model:  settings.model,
        messages: trimmed
      });

      // 5) insert assistant
      const asst = await createMessage({
        chat_id: anchorId,
        role: 'assistant',
        content: [{ type: 'text', text: error ? `Error: ${error}` : content }]
      });
      setChats(cs => cs.map(c =>
        c.id === anchorId
          ? { ...c, messages: [...trimmed, asst] }
          : c
      ));

      // 6) show toast with “undo”
      showToast('Archived messages. Undo?', () =>
        runTask(async () => {
          await undoArchiveMessagesAfter(anchorId, anchor.created_at);
          await deleteMessage(asst.id);
          const undone = await fetchMessages(anchorId);
          setChats(u => u.map(cc => cc.id === anchorId ? { ...cc, messages: undone } : cc));
        })
      );
    });
  }

  /**
   * Create a brand new chat
   */
  function handleNewChat() {
    if (loadingSend) return;
    runTask(async () => {
      const c = await createChat({ title: 'New Chat', model: settings.codeType });
      setEditing(null);
      setChats(cs => [{
        id:      c.id,
        title:   c.title,
        started: c.created_at,
        model:   c.code_type,
        messages:[]
      }, ...cs]);
      setCurrent(c.id);
    });
  }

  /**
   * Rename a chat
   */
  async function handleRenameChat(id, newTitle) {
    setChats(cs => cs.map(c => c.id === id ? { ...c, title: newTitle } : c));
    try {
      await updateChatTitle(id, newTitle);
    } catch (err) {
      safeAlert('Rename failed: ' + err.message);
      // revert
      const rows = await fetchChats();
      const shaped = rows.map(r => ({
        id:      r.id,
        title:   r.title,
        started: r.created_at,
        model:   r.code_type,
        messages:[]
      }));
      setChats(shaped);
    }
  }

  /**
   * Soft-delete a chat, with undo
   */
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
            id:      r.id,
            title:   r.title,
            started: r.created_at,
            model:   r.code_type,
            messages:[]
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

  /**
   * Soft-delete a single message, with undo
   */
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

  /**
   * (NEW) Enable editing a user message again
   */
  function handleStartEdit(msg) {
    setEditing(msg.id);
    // Pull plain text out so user can edit
    const txt = Array.isArray(msg.content)
      ? msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : String(msg.content);
    setEditText(txt);
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  if (loadingChats) {
    return (
      <h2 style={{ textAlign: 'center', marginTop: '20vh' }}>
        Loading…
      </h2>
    );
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
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>konzuko-code</span>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <div style={{ padding: '4px 12px', background: '#4f8eff', borderRadius: 4 }}>
              Tokens: {tokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll}>
              Copy All Text
            </button>
          </div>
        </div>

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
          {/* ───────── chat messages (left side) ───────── */}
          <div
            className="chat-container"
            ref={chatContainerRef}
          >
            {/* The “nav rail” (scroll up/down) */}
            <div className="chat-nav-rail">
              <button
                className="button icon-button"
                onClick={scrollToPrev}
                title="Scroll to previous message"
                aria-label="Scroll to previous message"
              >
                ↑
              </button>
              <button
                className="button icon-button"
                onClick={scrollToNext}
                title="Scroll to next message"
                aria-label="Scroll to next message"
              >
                ↓
              </button>
            </div>

            {currentChat.messages.map((m, idx) => {
              const isAsst = (m.role === 'assistant');

              // Helper to copy entire message text
              const copyFull = () => {
                if (Array.isArray(m.content)) {
                  const txt = m.content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join('');
                  navigator.clipboard.writeText(txt);
                } else {
                  navigator.clipboard.writeText(String(m.content));
                }
              };

              // Only the last user message is "editable"
              const isLastUser = (
                m.role === 'user' &&
                idx === currentChat.messages.length - 1 &&
                !editingId
              );

              return (
                <div key={m.id} className={`message message-${m.role}`}>
                  {/* floating controls: copy, edit, resend, etc. */}
                  <div className="floating-controls">
                    {isAsst && (
                      <button
                        className="button icon-button"
                        onClick={copyFull}
                        title="Copy entire message"
                      >
                        📋
                      </button>
                    )}
                  </div>

                  <div className="message-header">
                    <span className="message-role">
                      {isAsst ? `assistant #${idx}` : m.role}
                    </span>

                    <div className="message-actions">
                      {m.id === editingId ? (
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
                            onClick={handleCancelEdit}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="button icon-button"
                            onClick={copyFull}
                          >
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
                            disabled={loadingSend}
                            onClick={() => handleDeleteMessage(m.id)}
                          >
                            Del
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="message-content">
                    {m.id === editingId ? (
                      // user is editing this message
                      <textarea
                        rows={4}
                        style={{ width: '100%' }}
                        value={editText}
                        onInput={e => setEditText(e.target.value)}
                      />
                    ) : Array.isArray(m.content) ? (
                      // each block -> either text or image
                      m.content.map((c, j) => {
                        if (c.type === 'text') {
                          return (
                            <div key={j} style={{ width: '100%' }}>
                              <MarkdownRenderer>{c.text}</MarkdownRenderer>
                            </div>
                          );
                        } else if (c.type === 'image_url') {
                          return (
                            <img
                              key={j}
                              src={c.image_url?.url || ''}
                              alt="img"
                              style={{ maxWidth: '200px', margin: '8px 0' }}
                            />
                          );
                        }
                        return null;
                      })
                    ) : (
                      // single string fallback
                      <div style={{ whiteSpace: 'pre-wrap' }}>
                        <MarkdownRenderer>{String(m.content)}</MarkdownRenderer>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ───────── prompt builder (right side) ───────── */}
          <div style={{ width: '50%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={loadingSend}
              handleSend={handleSend}
              showToast={showToast}
              onImageDrop={setPendingImages}
              onRemoveImage={i => {
                setPendingImages(a => {
                  revokeOnce(a[i]);
                  return a.filter((_, j) => j !== i);
                });
              }}
              imagePreviews={pendingImages}
            />
          </div>
        </div>
      </div>

      {/* ephemeral toast */}
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

