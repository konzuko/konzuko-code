/* ------------------------------------------------------------------
   src/App.jsx  –  FULL, paste-ready file
-------------------------------------------------------------------*/
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

  fetchChats,          fetchMessages,
  createChat,          createMessage,
  updateMessage,       deleteMessage,
  updateChatTitle,     deleteChat,

  archiveMessagesAfter,
  undoArchiveMessagesAfter,
  undoDeleteMessage,
  undoDeleteChat
} from './api.js';

import {
  useSettings, useFormData, useMode,
  useTokenCount, useUndoableDelete
} from './hooks.js';

import { queue }       from './lib/TaskQueue.js';
import { asciiTree }   from './lib/textUtils.js';

/* ───────────────────────── helpers ───────────────────────── */
const revokeOnce = obj => { if (obj?.revoke) { obj.revoke(); obj.revoke = null; } };
const TARGET_GEMINI_MODEL = "gemini-2.5-pro-preview-05-06";


/* ============================================================
   APP COMPONENT
============================================================ */
export default function App() {
  /* ── primary state ─────────────────────────────────────── */
  const [chats,         setChats]         = useState([]);
  const [currentChatId, setCurrent]       = useState(null);
  const [loadingChats,  setLoadingChats]  = useState(true);

  const [loadingSend,   setLoadingSend]   = useState(false);

  const [editingId,     setEditing]       = useState(null);
  const [editText,      setEditText]      = useState('');
  const [savingEdit,    setSaving]        = useState(false);

  const [pendingImages, setPendingImages] = useState([]); // [{name,url, revoke?}]
  const [pendingPDFs,   setPendingPDFs]   = useState([]); // [{name,fileId (Gemini URI), mimeType}]
  const [pendingFiles,  setPendingFiles]  = useState([]); // code/text files

  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  const busy          = loadingSend || savingEdit;
  const currentChat   = chats.find(c => c.id === currentChatId) ?? { messages: [] };
  const tokenCount    = useTokenCount(currentChat.messages, settings.model);
  const showToast     = useCallback((txt, undo) => Toast(txt, 6000, undo), []);
  const undoableDelete = useUndoableDelete(showToast);

  /* ── chat scroll ref and helpers ───────────────────────── */
  const chatBoxRef = useRef(null);

  const scrollToPrev = () => {
    const box = chatBoxRef.current; if (!box) return;
    const rows = Array.from(box.querySelectorAll('.message'));
    const cur  = box.scrollTop;
    let tgt = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].offsetTop < cur - 1) { tgt = rows[i]; break; }
    }
    box.scrollTop = tgt ? tgt.offsetTop : 0;
  };

  const scrollToNext = () => {
    const box = chatBoxRef.current; if (!box) return;
    const rows = Array.from(box.querySelectorAll('.message'));
    const cur  = box.scrollTop;
    let tgt = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].offsetTop > cur + 1) { tgt = rows[i]; break; }
    }
    box.scrollTop = tgt ? tgt.offsetTop : box.scrollHeight;
  };

  /* ── queued task helper (serialises API ops) ───────────── */
  const runTask = useCallback(
    async fn => {
      setLoadingSend(true);
      try { await queue.push(fn); }
      catch (err) {
        console.error(err);
        Toast(err?.message || 'Unknown error', 5000);
      }
      finally { setLoadingSend(false); }
    },
    []
  );

  /* ── cleanup object-URLs when list changes / unmount ───── */
  useEffect(() => () => {
    pendingImages.forEach(revokeOnce);
  }, [pendingImages]);

  /* ── initial chat list load ────────────────────────────── */
  useEffect(() => {
    let live = true;
    runTask(async () => {
      setLoadingChats(true);

      const rows = await fetchChats();
      let shaped = rows.map(r => ({
        id: r.id, title: r.title, started: r.created_at,
        model: r.code_type || TARGET_GEMINI_MODEL,
        messages: []
      }));

      if (!shaped.length) {
        const c = await createChat({ title: 'New Chat' });
        shaped = [{
          id: c.id, title: c.title, started: c.created_at,
          model: c.code_type, messages: []
        }];
      }

      if (live) { setChats(shaped); setCurrent(shaped[0].id); }
    }).finally(() => live && setLoadingChats(false));

    return () => { live = false; };
  }, [runTask]);

  /* ── load messages when currentChatId changes ──────────── */
  useEffect(() => {
    if (!currentChatId) return;
    let live = true;
    fetchMessages(currentChatId)
      .then(msgs => live && setChats(cs => cs.map(c =>
        c.id === currentChatId ? { ...c, messages: msgs } : c
      )))
      .catch(err => Toast('Failed to fetch messages: ' + err.message, 5000));
    return () => { live = false; };
  }, [currentChatId]);

  /* ========================================================
     Chat-level helpers
  ======================================================== */
  function handleNewChat() {
    if (busy) return;
    runTask(async () => {
      const c = await createChat({ title: 'New Chat' });
      setChats(cs => [
        { id: c.id, title: c.title, started: c.created_at, model: c.code_type, messages: [] },
        ...cs
      ]);
      setCurrent(c.id);
    });
  }

  function handleRenameChat(id, title) {
    setChats(cs => cs.map(c => c.id === id ? { ...c, title } : c));
    runTask(() => updateChatTitle(id, title)
      .catch(err => Toast('Rename failed: ' + err.message, 5000)));
  }

  function handleDeleteChat(id) {
    if (busy) return;
    const anchorId = currentChatId;

    undoableDelete({
      itemLabel  : 'Chat',
      deleteFn   : () => runTask(() => deleteChat(id)),
      undoFn     : () => runTask(async () => {
        await undoDeleteChat(id);
        const rows = await fetchChats();
        setChats(rows.map(r => ({
          id: r.id, title: r.title, started: r.created_at,
          model: r.code_type || TARGET_GEMINI_MODEL, messages: []
        })));
        setCurrent(id);
      }),
      afterDelete: () => {
        setChats(cs => {
          const remaining = cs.filter(c => c.id !== id);
          if (anchorId === id) setCurrent(remaining[0]?.id ?? null);
          return remaining;
        });
      }
    });
  }

  /* ========================================================
     Prompt helpers
  ======================================================== */
  function buildUserPrompt() {
    if (mode === 'DEVELOP') {
      const out = ['MODE: DEVELOP'];

      if (form.developGoal.trim())         out.push(`GOAL: ${form.developGoal.trim()}`);
      if (form.developFeatures.trim())     out.push(`FEATURES: ${form.developFeatures.trim()}`);
      if (form.developReturnFormat.trim()) out.push(`RETURN FORMAT: ${form.developReturnFormat.trim()}`);
      if (form.developWarnings.trim())     out.push(`THINGS TO REMEMBER/WARNINGS: ${form.developWarnings.trim()}`);
      if (form.developContext.trim())      out.push(`CONTEXT: ${form.developContext.trim()}`);

      const treePaths = pendingFiles.filter(f => f.insideProject).map(f => f.fullPath);
      if (treePaths.length) {
        out.push(`/* File structure:\n${asciiTree(treePaths)}\n*/`);
      }

      pendingFiles.forEach(f => {
        out.push('```yaml');
        out.push(`file: ${f.fullPath}`);
        if (f.note) out.push(`# ${f.note}`);
        out.push('```');
        out.push('```');
        out.push(f.text);
        out.push('```');
      });
      return out.join('\n');
    }
    if (mode === 'COMMIT') return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (mode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    return '';
  }

  function resetForm() {
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]);
  }

  /* ========================================================
     SEND
  ======================================================== */
  function handleSend() {
    if (busy) return;

    if (!settings.apiKey) {
      Toast("Gemini API Key is missing. Please set it in settings.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    runTask(async () => {
      const existingMessages = await fetchMessages(currentChatId);
      const textPrompt = buildUserPrompt();

      const userMessageContentBlocks = [
        ...pendingPDFs.map(p => ({
          type: 'file',
          file: {
            file_id: p.fileId,
            original_name: p.name,
            mime_type: p.mimeType
          }
        })),
        ...pendingImages.map(img => ({
          type: 'image_url',
          image_url: { url: img.url, detail: 'high', original_name: img.name }
        })),
        { type: 'text', text: textPrompt }
      ];

      const userRow = await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: userMessageContentBlocks
      });

      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, userRow] }
          : c
      ));

      const messagesForApi = [...existingMessages, userRow];
      
      // console.log("API Key being sent to callApiForText:", settings.apiKey); // For debugging
      const { content: assistantContent, error: apiError, details: apiErrorDetails } = await callApiForText({
        apiKey: settings.apiKey,
        messages: messagesForApi
      });
      
      let assistantText = assistantContent;
      if (apiError) {
        assistantText = `Error: ${apiError}`;
        if (apiErrorDetails) assistantText += `\nDetails: ${apiErrorDetails}`;
        Toast(assistantText, 8000);
      }

      const assistantRow = await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }]
      });

      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: [...c.messages, assistantRow] }
          : c
      ));

      resetForm();
    });
  }

  /* ========================================================
     Message-level helpers (edit / resend / delete)
  ======================================================== */
  function handleStartEdit(msg) {
    setEditing(msg.id);
    const textBlock = Array.isArray(msg.content)
      ? msg.content.find(b => b.type === 'text')
      : { text: String(msg.content) };
    setEditText(textBlock?.text || '');
  }
  function handleCancelEdit() { setEditing(null); setEditText(''); }

  async function handleSaveEdit() {
    if (!editingId || busy) return;

    if (!settings.apiKey) {
      Toast("Gemini API Key is missing. Please set it in settings before saving edit.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    setSaving(true);
    runTask(async () => {
      const msgs = await fetchMessages(currentChatId);
      const msgIndex = msgs.findIndex(x => x.id === editingId);
      if (msgIndex === -1) throw new Error('Message not found for editing');

      const originalMessage = msgs[msgIndex];
      const originalContent = Array.isArray(originalMessage.content) ? originalMessage.content : [{type: 'text', text: String(originalMessage.content)}];

      const newContentArray = originalContent.map(block =>
        block.type === 'text' ? { ...block, text: editText } : block
      );
      if (!newContentArray.some(b => b.type === 'text')) {
          newContentArray.push({ type: 'text', text: editText });
      }

      await updateMessage(editingId, newContentArray);
      msgs[msgIndex] = { ...originalMessage, content: newContentArray };

      await archiveMessagesAfter(currentChatId, msgs[msgIndex].created_at);

      const { content, error, details: apiErrorDetails } = await callApiForText({
        apiKey: settings.apiKey,
        messages: msgs.slice(0, msgIndex + 1)
      });

      let assistantText = content;
      if (error) {
        assistantText = `Error: ${error}`;
        if (apiErrorDetails) assistantText += `\nDetails: ${apiErrorDetails}`;
        Toast(assistantText, 8000);
      }

      await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }]
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

    if (!settings.apiKey) {
      Toast("Gemini API Key is missing. Please set it in settings before resending.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    runTask(async () => {
      const msgs = await fetchMessages(currentChatId);
      const anchorMsgIndex = msgs.findIndex(x => x.id === id);
      if (anchorMsgIndex === -1) throw new Error('Message not found for resend');
      const anchor = msgs[anchorMsgIndex];

      await archiveMessagesAfter(currentChatId, anchor.created_at);
      const messagesForApi = msgs.slice(0, anchorMsgIndex + 1);

      const { content, error, details: apiErrorDetails } = await callApiForText({
        apiKey: settings.apiKey,
        messages: messagesForApi
      });

      let assistantText = content;
      if (error) {
        assistantText = `Error: ${error}`;
        if (apiErrorDetails) assistantText += `\nDetails: ${apiErrorDetails}`;
        Toast(assistantText, 8000);
      }

      const asst = await createMessage({
        chat_id: currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }]
      });

      const refreshedMessages = await fetchMessages(currentChatId);
      setChats(cs => cs.map(c =>
        c.id === currentChatId
          ? { ...c, messages: refreshedMessages }
          : c
      ));

      showToast('Archived subsequent messages. Undo?', () =>
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

  /* ========================================================
     Copy conversation helper
  ======================================================== */
  function handleCopyAll() {
    const txt = currentChat.messages.map(m => {
      const contentArray = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      return contentArray.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(txt)
      .catch(() => Toast('Copy failed (clipboard API)', 4000));
  }

  /* ========================================================
     UI
  ======================================================== */
  if (loadingChats) {
    return <h2 style={{textAlign:'center',marginTop:'20vh'}}>Loading…</h2>;
  }

  return (
    <div className="app-container">
      <ChatPane
        chats          ={chats}
        currentChatId  ={currentChatId}
        onSelectChat   ={setCurrent}
        onNewChat      ={handleNewChat}
        onTitleUpdate  ={handleRenameChat}
        onDeleteChat   ={handleDeleteChat}
        disabled       ={busy}
      />
      <div className="main-content">
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>konzuko-code</span>
          <div style={{marginLeft:'auto',display:'flex',gap:'0.5em'}}>
            <div style={{padding:'4px 12px',background:'#4f8eff',borderRadius:4, fontSize: '0.9em'}}>
              Tokens: {tokenCount.toLocaleString()} (approx. OpenAI)
            </div>
            <button className="button" onClick={handleCopyAll}>Copy All Text</button>
          </div>
        </div>
        {settings.showSettings && (
          <div className="settings-panel" style={{padding:'1em',borderBottom:'1px solid var(--border)'}}>
            <div className="form-group">
              <label>Gemini API Key (Google AI Studio):</label>
              <input
                className="form-input"
                value={settings.apiKey}
                onInput={e => setSettings(s => ({ ...s, apiKey:e.target.value }))}
                placeholder="Enter your Gemini API Key"
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <input
                className="form-input"
                value={TARGET_GEMINI_MODEL}
                readOnly
                style={{backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'default'}}
              />
            </div>
          </div>
        )}
        <div className="content-container" style={{display:'flex',flex:1}}>
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
          <div style={{width:'50%',display:'flex',flexDirection:'column',overflowY:'auto'}}>
            <PromptBuilder
              mode          ={mode}            setMode       ={setMode}
              form          ={form}            setForm       ={setForm}
              loadingSend   ={busy}            handleSend    ={handleSend}
              showToast     ={showToast}
              imagePreviews ={pendingImages}
              pdfPreviews   ={pendingPDFs}
              onRemoveImage ={i => setPendingImages(a => {
                revokeOnce(a[i]); return a.filter((_,j)=>j!==i);
              })}
              onAddImage    ={img => setPendingImages(a => [...a, img])}
              onAddPDF      ={pdf => setPendingPDFs(a => [...a, pdf])}
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