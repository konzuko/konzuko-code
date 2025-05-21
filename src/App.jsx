// src/App.jsx
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import ChatList from './ChatList.jsx'; // Changed from ChatPane
import PromptBuilder from './PromptBuilder.jsx';
import ChatArea from './components/ChatArea.jsx';
import Toast from './components/Toast.jsx';

import {
  callApiForText,
  fetchMessages,
  createChat as apiCreateChat, // Renamed to avoid conflict
  createMessage as apiCreateMessage,
  updateMessage as apiUpdateMessage, // For future use (edit)
  deleteChat as apiDeleteChat,
  // ... other api functions if needed for mutations
  GEMINI_MODEL_NAME
} from './api.js';

import {
  useSettings, useFormData, useMode,
  // useUndoableDelete, // TQ mutations handle success/error states better for API calls
  INITIAL_FORM_DATA
} from './hooks.js'; // Ensure useUndoableDelete is removed or adapted if used for non-TQ actions
import { useTokenizableContent } from './hooks/useTokenizableContent.js';

import { queue } from './lib/TaskQueue.js'; // May be less needed with TQ for API calls
import { asciiTree } from './lib/textUtils.js';
import { IMAGE_TOKEN_ESTIMATE } from './config.js';
import { countTokensWithGemini } from './lib/tokenWorkerClient.js';

const revokeOnce = obj => { if (obj?.revoke) { obj.revoke(); obj.revoke = null; } };

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles) {
    // ... (buildNewUserPromptText function remains the same)
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

export default function App() {
  const queryClient = useQueryClient();

  const [currentChatId, setCurrentChatId] = useState(null);

  // State for prompt building, UI, settings
  const [editingId, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  // const [savingEdit, setSaving] = useState(false); // Will be mutation.isLoading

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs, setPendingPDFs] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);

  const [settings, setSettings] = useSettings();
  const [form, setForm] = useFormData();
  const [mode, setMode] = useMode();

  // Token counting state
  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const chatBoxRef = useRef(null);

  // Fetch messages for the current chat
  const { data: currentChatMessagesData, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['messages', currentChatId],
    queryFn: () => fetchMessages(currentChatId),
    enabled: !!currentChatId, // Only fetch if currentChatId is set
    staleTime: 1000 * 60 * 1, // Messages can be staler than chat list (1 min)
  });
  const currentChatMessages = currentChatMessagesData || [];


  const itemsForApiCount = useTokenizableContent(
    currentChatMessages, // Use messages from TQ
    form,
    mode,
    pendingFiles,
    pendingPDFs
  );

  const showToast = useCallback((txt, undoFn) => Toast(txt, 6000, undoFn), []);
  // const undoableDelete = useUndoableDelete(showToast); // Replaced by TQ mutation logic

  // Mutations
  const createChatMutation = useMutation({
    mutationFn: (newChatData) => apiCreateChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (newlyCreatedChat && newlyCreatedChat.id) {
        setCurrentChatId(newlyCreatedChat.id); // Select the new chat
      }
      Toast('New chat created!', 2000);
    },
    onError: (error) => {
      Toast('Failed to create chat: ' + error.message, 5000);
      console.error("Create chat error:", error);
    }
  });

  const deleteChatMutation = useMutation({
    mutationFn: (chatId) => apiDeleteChat(chatId),
    onSuccess: (data, chatId) => { // data is {success: true, id: chatId}
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (currentChatId === chatId) {
        setCurrentChatId(null); // Deselect, ChatList will pick the next one
      }
      Toast('Chat deleted.', 3000 /*, () => handleUndoDelete(chatId) // TODO: Undo for TQ */);
    },
    onError: (error) => {
      Toast('Failed to delete chat: ' + error.message, 5000);
    }
  });
  
  const sendMessageMutation = useMutation({
    mutationFn: async (payload) => {
      // payload = { currentChatId, userMessageContentBlocks, settings, form, mode, pendingFiles, existingMessages }
      
      // 1. Create user message (optimistically or via API)
      const userRow = await apiCreateMessage({
        chat_id: payload.currentChatId,
        role: 'user',
        content: payload.userMessageContentBlocks
      });

      // Optimistically update messages cache to show user message immediately
      queryClient.setQueryData(['messages', payload.currentChatId], (oldMessages = []) => [...oldMessages, userRow]);

      // 2. Prepare messages for AI (including the new user message)
      const messagesForApi = [...payload.existingMessages, userRow];
      
      // 3. Call AI
      const { content: assistantContent } = await callApiForText({
        apiKey: payload.settings.apiKey,
        messages: messagesForApi
        // signal can be added here if needed
      });
      
      // 4. Create assistant message
      const assistantRow = await apiCreateMessage({
        chat_id: payload.currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }] // Ensure content is an array of blocks
      });
      
      return { userRow, assistantRow }; // Return for potential further cache updates
    },
    onSuccess: (data, variables) => {
      // Invalidate messages for the current chat to ensure assistant message is properly fetched/updated from server
      // This also ensures the cache reflects the final server state.
      queryClient.invalidateQueries({ queryKey: ['messages', variables.currentChatId] });
      resetForm(); // Your existing resetForm
    },
    onError: (error, variables) => {
      Toast(`Error sending message: ${error.message}`, 8000);
      console.error("Send message error:", error);
      // Optional: Revert optimistic update for user message if it failed before AI call
      // This is more complex and depends on where the failure occurred.
      // For now, a full refetch from invalidation is simpler.
      queryClient.invalidateQueries({ queryKey: ['messages', variables.currentChatId] });
    }
  });


  const busy = useMemo(() => 
    createChatMutation.isPending || 
    deleteChatMutation.isPending || 
    sendMessageMutation.isPending ||
    // isLoadingMessages || //isLoadingMessages is for current chat, not a global busy state for UI disabling
    isCountingApiTokens,
  [
    createChatMutation.isPending, 
    deleteChatMutation.isPending,
    sendMessageMutation.isPending,
    // isLoadingMessages, 
    isCountingApiTokens
  ]);


  useEffect(() => () => { pendingImages.forEach(revokeOnce); }, [pendingImages]);

  // Token counting useEffect and helpers
  const callWorkerForTokenCount = useCallback(async (currentItemsForApi, currentApiKey, currentModel) => {
    // ... (callWorkerForTokenCount remains the same)
    const currentVersion = ++tokenCountVersionRef.current;
    if (!currentApiKey || String(currentApiKey).trim() === "") {
        if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(false); setApiCalculatedTokenCount(0); } return;
    }
    if (currentItemsForApi.length === 0) {
        if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(0); setIsCountingApiTokens(false); } return;
    }
    if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(true); } else { return; }
    try {
        const count = await countTokensWithGemini(currentApiKey, currentModel, currentItemsForApi);
        if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(count); }
    } catch (error) {
        if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(0); }
    } finally {
        if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(false); }
    }
  }, [setApiCalculatedTokenCount, setIsCountingApiTokens]);

  useEffect(() => {
    if (!debouncedApiCallRef.current) {
        debouncedApiCallRef.current = debounce(callWorkerForTokenCount, 750);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTokenCount]);


  function handleNewChat() {
    if (busy) return;
    createChatMutation.mutate({ title: 'New Chat', model: GEMINI_MODEL_NAME });
  }

  function handleDeleteChat(id) {
    // Confirmation dialog can be added here if desired before mutating
    if (busy) return;
    if (confirm('Delete this chat? This action cannot be undone through the UI immediately.')) {
        deleteChatMutation.mutate(id);
    }
  }

  function resetForm() {
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]);
    setForm(INITIAL_FORM_DATA);
  }

  function handleSend() {
    if (sendMessageMutation.isPending || busy) return;

    if (!settings.apiKey || String(settings.apiKey).trim() === "") {
      Toast("Gemini API Key is missing. Please set it in settings.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    const newUserTextPrompt = buildNewUserPromptText(form, mode, pendingFiles);
    const userMessageContentBlocks = [];
    
    pendingPDFs.forEach(p => userMessageContentBlocks.push({
      type: 'file', file: { file_id: p.fileId, original_name: p.name, mime_type: p.mimeType }
    }));
    pendingImages.forEach(img => userMessageContentBlocks.push({
      type: 'image_url', image_url: { url: img.url, detail: 'high', original_name: img.name }
    }));
    if (newUserTextPrompt && newUserTextPrompt.trim() !== "") {
      userMessageContentBlocks.push({ type: 'text', text: newUserTextPrompt });
    }
    
    if (userMessageContentBlocks.length === 0) {
      Toast("Cannot send an empty message.", 3000);
      return;
    }

    sendMessageMutation.mutate({
      currentChatId,
      userMessageContentBlocks,
      settings,
      form, // For context if needed by mutationFn, though not directly used now
      mode, // For context
      pendingFiles, // For context
      existingMessages: currentChatMessages, // Pass current messages for context to AI
    });
  }

  // TODO: Refactor edit/resend/delete message with TQ mutations
  function handleStartEdit(msg) { /* ... */ }
  function handleCancelEdit() { /* ... */ }
  async function handleSaveEdit() { /* ... implement with useMutation ... */ }
  function handleResendMessage(id) { /* ... implement with useMutation ... */ }
  function handleDeleteMessage(id) { /* ... implement with useMutation ... */ }


  const scrollToPrev = () => { /* ... */ };
  const scrollToNext = () => { /* ... */ };
  
  const handleCopyAll = () => {
    const txt = currentChatMessages.map(m => { // Use messages from TQ
      const contentArray = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      return contentArray.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(txt)
      .then(() => Toast('Copied all text to clipboard!', 2000))
      .catch(() => Toast('Copy failed (clipboard API)', 4000));
  };

  const totalPromptTokenCount = useMemo(() => {
    // ... (token count logic remains similar, using currentChatMessages from TQ)
    let estimatedImageTokens = 0;
    estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    (currentChatMessages || []).forEach(msg => {
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
  }, [apiCalculatedTokenCount, pendingImages, currentChatMessages]);


  // Main App Loading State: Initially, we wait for ChatList to determine if it's loading.
  // App.jsx doesn't have its own `loadingChats` anymore for the list.
  // If ChatList is loading (isLoadingChats passed to it), it will show its own loader.

  return (
    <div className="app-container">
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={setCurrentChatId}
        // Pass TQ-ified mutation triggers or let ChatList handle its own mutations eventually
        // For now, App.jsx handles mutations and ChatList just displays.
        // onNewChat={handleNewChat} // ChatList handles this and calls `onSelectChat`
        // onTitleUpdate, onDeleteChat are passed to ChatPaneLayout from ChatList
        appDisabled={busy}
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
          <div style={{marginLeft:'auto',display:'flex',gap:'0.5em', alignItems: 'center'}}>
            <div style={{padding:'4px 12px',background:'var(--accent)', color: 'white', borderRadius:4, fontSize: '0.9em', minHeight: 'calc(1.5em + 8px)', display: 'flex', alignItems: 'center', opacity: isCountingApiTokens ? 0.7 : 1}}>
              Tokens: {isCountingApiTokens ? 'Counting...' : totalPromptTokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll} disabled={currentChatMessages.length === 0}>Copy All Text</button>
          </div>
        </div>
        {settings.showSettings && (
          <div className="settings-panel" style={{padding:'1em',borderBottom:'1px solid var(--border)'}}>
            {/* ... settings form ... */}
            <div className="form-group">
              <label>Gemini API Key (Google AI Studio):</label>
              <input
                className="form-input"
                type="password"
                value={settings.apiKey}
                onInput={e => setSettings(s => ({ ...s, apiKey:e.target.value }))}
                placeholder="Enter your Gemini API Key"
              />
            </div>
            <div className="form-group">
              <label>Model:</label>
              <input
                className="form-input"
                value={GEMINI_MODEL_NAME} // Use constant from api.js or config.js
                readOnly
                style={{backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'default'}}
              />
            </div>
          </div>
        )}
        <div className="content-container" style={{display:'flex',flex:1, overflow:'hidden'}}>
          <div className="chat-container" ref={chatBoxRef} style={{position: 'relative'}}> {/* Added position relative for nav rail */}
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev}>↑</button>
              <button className="button icon-button" onClick={scrollToNext}>↓</button>
            </div>
            {isLoadingMessages && currentChatId && <div style={{textAlign: 'center', padding: '2rem'}}>Loading messages...</div>}
            {!isLoadingMessages && currentChatId && (
              <ChatArea
                messages={currentChatMessages}
                editingId={editingId}
                editText={editText}
                loadingSend={sendMessageMutation.isPending} // Use mutation pending state
                savingEdit={false /* TODO: Replace with editMutation.isPending */}
                setEditText={setEditText}
                handleSaveEdit={handleSaveEdit}
                handleCancelEdit={handleCancelEdit}
                handleStartEdit={handleStartEdit}
                handleResendMessage={handleResendMessage}
                handleDeleteMessage={handleDeleteMessage}
              />
            )}
            {!currentChatId && <div style={{textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)'}}>Select a chat to start.</div>}
          </div>
          <div style={{width:'50%',display:'flex',flexDirection:'column',overflowY:'auto'}}>
            <PromptBuilder
              mode={mode} setMode={setMode}
              form={form} setForm={setForm}
              loadingSend={sendMessageMutation.isPending} // Use mutation pending state
              handleSend={handleSend}
              showToast={showToast}
              imagePreviews={pendingImages}
              pdfPreviews={pendingPDFs}
              onRemoveImage={i => {
                revokeOnce(pendingImages[i]);
                setPendingImages(a => a.filter((_,j)=>j!==i));
              }}
              onAddImage={img => setPendingImages(a => [...a, img])}
              onAddPDF={pdf => setPendingPDFs(a => [...a, pdf])}
              settings={settings}
              pendingFiles={pendingFiles}
              onFilesChange={setPendingFiles}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
