/* ------------------------------------------------------------------
   src/App.jsx  –  FULL, paste-ready file
-------------------------------------------------------------------*/
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
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
  useUndoableDelete
} from './hooks.js';
import { useTokenizableContent } from './hooks/useTokenizableContent.js'; 

import { queue }       from './lib/TaskQueue.js';
import { asciiTree }   from './lib/textUtils.js';
import { IMAGE_TOKEN_ESTIMATE } from './config.js';
import { countTokensWithGemini } from './lib/tokenWorkerClient.js';

/* ───────────────────────── helpers ───────────────────────── */
const revokeOnce = obj => { if (obj?.revoke) { obj.revoke(); obj.revoke = null; } };
const TARGET_GEMINI_MODEL = "gemini-2.5-pro-preview-05-06";

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles) {
    if (currentMode === 'DEVELOP') {
      const out = ['MODE: DEVELOP'];
      if (currentForm.developGoal.trim())         out.push(`GOAL: ${currentForm.developGoal.trim()}`);
      if (currentForm.developFeatures.trim())     out.push(`FEATURES: ${currentForm.developFeatures.trim()}`);
      if (currentForm.developReturnFormat.trim()) out.push(`RETURN FORMAT: ${currentForm.developReturnFormat.trim()}`);
      if (currentForm.developWarnings.trim())     out.push(`THINGS TO REMEMBER/WARNINGS: ${currentForm.developWarnings.trim()}`);
      if (currentForm.developContext.trim())      out.push(`CONTEXT: ${currentForm.developContext.trim()}`);

      const treePaths = currentPendingFiles.filter(f => f.insideProject).map(f => f.fullPath);
      if (treePaths.length) {
        out.push(`/* File structure:\n${asciiTree(treePaths)}\n*/`);
      }
      currentPendingFiles.forEach(f => {
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
    if (currentMode === 'COMMIT') return 'MODE: COMMIT\nPlease generate a git-style commit message.';
    if (currentMode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    return '';
}


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

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs,   setPendingPDFs]   = useState([]);
  const [pendingFiles,  setPendingFiles]  = useState([]);

  const [settings, setSettings] = useSettings();
  const [form,     setForm]     = useFormData();
  const [mode,     setMode]     = useMode();

  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);
  
  // chatBoxRef definition WAS MISSING in the previous full paste
  const chatBoxRef = useRef(null);


  const busy          = loadingSend || savingEdit || isCountingApiTokens;
  const currentChat   = useMemo(() => chats.find(c => c.id === currentChatId) ?? { messages: [] }, [chats, currentChatId]);
  
  const itemsForApiCount = useTokenizableContent(
    currentChat.messages,
    form,
    mode,
    pendingFiles,
    pendingPDFs
  );

  const showToast     = useCallback((txt, undo) => Toast(txt, 6000, undo), []);
  const undoableDelete = useUndoableDelete(showToast);

  // stableRunTask definition WAS MISSING detail in the previous full paste
  const stableRunTask = useCallback(async fn => {
      setLoadingSend(true);
      try { await queue.push(fn); }
      catch (err) {
        console.error(err);
        Toast(err?.message || 'Unknown error', 5000);
      }
      finally { setLoadingSend(false); }
    }, []); // Dependencies: queue and Toast are global/stable, setLoadingSend is from useState

  // scrollToPrev and scrollToNext definitions WERE MISSING in the previous full paste
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

  useEffect(() => () => { pendingImages.forEach(revokeOnce); }, [pendingImages]);

  useEffect(() => {
    let live = true;
    stableRunTask(async () => {
      setLoadingChats(true);
      const rows = await fetchChats();
      let shaped = rows.map(r => ({
        id: r.id, title: r.title, started: r.created_at,
        model: r.code_type || TARGET_GEMINI_MODEL, messages: []
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
  }, [stableRunTask]); // stableRunTask is now a dependency

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

  function handleNewChat() {
    if (busy) return;
    stableRunTask(async () => {
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
    stableRunTask(() => updateChatTitle(id, title)
      .catch(err => Toast('Rename failed: ' + err.message, 5000)));
  }

  function handleDeleteChat(id) {
    if (busy) return;
    const anchorId = currentChatId;
    undoableDelete({
      itemLabel  : 'Chat',
      deleteFn   : () => stableRunTask(() => deleteChat(id)),
      undoFn     : () => stableRunTask(async () => { 
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
  
  function resetForm() {
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]);
  }

  /* ========================================================
     GEMINI TOKEN COUNTING useEffect - Simplified
  ======================================================== */
  useEffect(() => {
    const callWorkerForTokenCount = async (currentItemsForApi, currentApiKey, currentModel) => {
        // console.log('[App.jsx] callWorkerForTokenCount CALLED. APIKey set:', !!currentApiKey);

        if (!currentApiKey || String(currentApiKey).trim() === "") {
            // console.log('[App.jsx] API Key is missing. Skipping token count call.');
            if (isCountingApiTokens) setIsCountingApiTokens(false);
            setApiCalculatedTokenCount(0);
            return;
        }

        const currentVersion = ++tokenCountVersionRef.current;
        // console.log(`[App.jsx] Starting token count v${currentVersion}.`);
        setIsCountingApiTokens(true);
        
        // console.log(`[App.jsx] v${currentVersion} - Items for API count (${currentItemsForApi.length}):`, JSON.stringify(currentItemsForApi.map(item => ({type: item.type, value: item.value ? item.value.substring(0,30)+'...' : undefined, uri: item.uri ? item.uri.substring(0,30)+'...' : undefined })), null, 2));

        if (currentItemsForApi.length === 0) {
            // console.log(`[App.jsx] v${currentVersion} - No text or PDFs for API count.`);
            if (tokenCountVersionRef.current === currentVersion) {
                setApiCalculatedTokenCount(0);
                setIsCountingApiTokens(false);
            }
            return;
        }
        
        try {
            const count = await countTokensWithGemini(currentApiKey, currentModel, currentItemsForApi);
            // console.log(`[App.jsx] v${currentVersion} - Received count: ${count}`);
            if (tokenCountVersionRef.current === currentVersion) {
                setApiCalculatedTokenCount(count);
            }
        } catch (error) {
            console.error(`[App.jsx] v${currentVersion} - Error counting tokens:`, error.message);
            if (tokenCountVersionRef.current === currentVersion) {
                setApiCalculatedTokenCount(0);
            }
        } finally {
            if (tokenCountVersionRef.current === currentVersion) {
                setIsCountingApiTokens(false);
            }
        }
    };

    if (!debouncedApiCallRef.current) {
        debouncedApiCallRef.current = debounce(callWorkerForTokenCount, 750);
    }
    
    const modelToUse = settings.model || TARGET_GEMINI_MODEL;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);

  }, [
      itemsForApiCount, 
      settings.apiKey, 
      settings.model,
  ]);


  /* ========================================================
     SEND
  ======================================================== */
  function handleSend() {
    if (busy) return;

    if (!settings.apiKey || String(settings.apiKey).trim() === "") {
      Toast("Gemini API Key is missing. Please set it in settings.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    stableRunTask(async () => {
      const existingMessages = currentChat.messages;
      const newUserTextPrompt = buildNewUserPromptText(form, mode, pendingFiles);

      const userMessageContentBlocks = [];
      
      pendingPDFs.forEach(p => {
        userMessageContentBlocks.push({
          type: 'file',
          file: { file_id: p.fileId, original_name: p.name, mime_type: p.mimeType }
        });
      });
      pendingImages.forEach(img => {
        userMessageContentBlocks.push({
          type: 'image_url',
          image_url: { url: img.url, detail: 'high', original_name: img.name }
        });
      });

      if (newUserTextPrompt && newUserTextPrompt.trim() !== "") {
        userMessageContentBlocks.push({ type: 'text', text: newUserTextPrompt });
      }
      
      if (userMessageContentBlocks.length === 0) {
        Toast("Cannot send an empty message (no text, images, or PDFs added to the current prompt).", 3000);
        return;
      }

      const userRow = await createMessage({
        chat_id: currentChatId,
        role: 'user',
        content: userMessageContentBlocks
      });

      setChats(prevChats => prevChats.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: [...c.messages, userRow] } 
          : c
      ));

      const messagesForApi = [...existingMessages, userRow]; 
      
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

      setChats(prevChats => prevChats.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: [...c.messages, assistantRow] } 
          : c
      ));

      resetForm();
    });
  }

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
    if (!settings.apiKey || String(settings.apiKey).trim() === "") { 
        Toast("Gemini API Key is missing. Please set it in settings before saving edit.", 5000);
        setSettings(s => ({ ...s, showSettings: true }));
        return; 
    }
    setSaving(true);
    stableRunTask(async () => {
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
    if (!settings.apiKey || String(settings.apiKey).trim() === "") { 
        Toast("Gemini API Key is missing. Please set it in settings before resending.", 5000);
        setSettings(s => ({ ...s, showSettings: true }));
        return; 
    }
    stableRunTask(async () => {
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
            stableRunTask(async () => {
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
      deleteFn   : () => stableRunTask(() => deleteMessage(id)),
      undoFn     : () => stableRunTask(async () => { 
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
  
  function handleCopyAll() {
    const txt = currentChat.messages.map(m => {
      const contentArray = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      return contentArray.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(txt)
      .catch(() => Toast('Copy failed (clipboard API)', 4000));
  }


  const totalPromptTokenCount = useMemo(() => {
    let estimatedImageTokens = 0;
    estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;

    const currentMessages = currentChat.messages || [];
    currentMessages.forEach(msg => {
        const contentBlocks = Array.isArray(msg.content)
            ? msg.content
            : [{ type: 'text', text: String(msg.content ?? '') }];
        contentBlocks.forEach(block => {
            if (block.type === 'image_url' && block.image_url && block.image_url.url) {
                estimatedImageTokens += IMAGE_TOKEN_ESTIMATE;
            }
        });
    });
    
    return apiCalculatedTokenCount + estimatedImageTokens;
  }, [apiCalculatedTokenCount, pendingImages, currentChat]);

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
              Tokens: {isCountingApiTokens ? 'Counting...' : totalPromptTokenCount.toLocaleString()} (Gemini)
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
          <div className="chat-container" ref={chatBoxRef}> {/* chatBoxRef is used here */}
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev}>↑</button>
              <button className="button icon-button" onClick={scrollToNext}>↓</button>
            </div>
            <ChatArea
              messages            ={currentChat.messages}
              editingId           ={editingId}
              editText            ={editText}
              loadingSend         ={loadingSend}
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
              loadingSend   ={loadingSend}
              handleSend    ={handleSend}
              showToast     ={showToast}
              imagePreviews ={pendingImages}
              pdfPreviews   ={pendingPDFs}
              onRemoveImage ={i => {
                revokeOnce(pendingImages[i]);
                setPendingImages(a => a.filter((_,j)=>j!==i));
              }}
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
