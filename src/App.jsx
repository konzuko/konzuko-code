// src/App.jsx
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import ChatList from './ChatList.jsx';
import PromptBuilder from './PromptBuilder.jsx';
import ChatArea from './components/ChatArea.jsx';
import Toast from './components/Toast.jsx'; // Ensure Toast can handle an undo function

import {
  callApiForText,
  fetchMessages,
  createChat as apiCreateChat,
  createMessage as apiCreateMessage,
  updateChatTitle as apiUpdateChatTitle,
  deleteChat as apiDeleteChat,
  deleteMessage as apiDeleteMessage,
  undoDeleteMessage as apiUndoDeleteMessage, // Import new API function
  GEMINI_MODEL_NAME,
} from './api.js';

import {
  useSettings, useFormData, useMode,
  INITIAL_FORM_DATA
} from './hooks.js';
import { useTokenizableContent } from './hooks/useTokenizableContent.js';

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
    // ... (buildNewUserPromptText function - no changes) ...
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

  const [editingId, setEditing] = useState(null);
  const [editText, setEditText] = useState('');

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs, setPendingPDFs] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);

  const [settings, setSettings] = useSettings();
  const [form, setForm] = useFormData();
  const [mode, setMode] = useMode();

  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const chatContainerRef = useRef(null);

  const { data: currentChatMessagesData, isLoading: isLoadingMessages } = useQuery({
    queryKey: ['messages', currentChatId],
    queryFn: () => fetchMessages(currentChatId),
    enabled: !!currentChatId,
    staleTime: 1000 * 60 * 2,
  });
  const currentChatMessages = currentChatMessagesData || [];

  const itemsForApiCount = useTokenizableContent(
    currentChatMessages,
    form,
    mode,
    pendingFiles,
    pendingPDFs
  );

  // --- Mutations ---
  const createChatMutation = useMutation({ /* ... (no changes) ... */ 
    mutationFn: (newChatData) => apiCreateChat(newChatData),
    onSuccess: (newlyCreatedChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] }).then(() => {
        if (newlyCreatedChat && newlyCreatedChat.id) {
          setCurrentChatId(newlyCreatedChat.id);
        }
      });
      Toast('New chat created!', 2000);
    },
    onError: (error) => {
      Toast('Failed to create chat: ' + error.message, 5000);
      console.error("Create chat error:", error);
    }
  });

  const deleteChatMutation = useMutation({ /* ... (no changes) ... */ 
    mutationFn: (chatId) => apiDeleteChat(chatId),
    onSuccess: (data, chatId) => { 
      queryClient.setQueryData(['chats'], (oldData) => {
          if (!oldData) return oldData;
          return {
              ...oldData,
              pages: oldData.pages.map(page => ({
                  ...page,
                  chats: page.chats.filter(chat => chat.id !== chatId)
              })).filter(page => page.chats.length > 0)
          };
      });
      if (currentChatId === chatId) {
          setCurrentChatId(null); 
      }
      Toast('Chat deleted.', 3000); // TODO: Add undo for chat deletion later
    },
    onError: (error) => {
      Toast('Failed to delete chat: ' + error.message, 5000);
    }
  });
  
  const updateChatTitleMutation = useMutation({ /* ... (no changes) ... */ 
    mutationFn: ({ id, title }) => apiUpdateChatTitle(id, title),
    onSuccess: (updatedResponseData, variables) => {
      queryClient.setQueryData(['chats'], (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map(page => ({
            ...page,
            chats: page.chats.map(chat =>
              chat.id === variables.id ? { ...chat, title: variables.title } : chat
            ),
          })),
        };
      });
      Toast('Title updated!', 2000);
    },
    onError: (error) => Toast('Failed to update title: ' + error.message, 5000)
  });

  const sendMessageMutation = useMutation({ /* ... (no changes) ... */ 
    mutationFn: async (payload) => {
      const userRow = await apiCreateMessage({
        chat_id: payload.currentChatId,
        role: 'user',
        content: payload.userMessageContentBlocks
      });
      queryClient.setQueryData(['messages', payload.currentChatId], (oldMessages = []) => [...oldMessages, userRow]);
      const messagesForApi = [...payload.existingMessages, userRow];
      const { content: assistantContent } = await callApiForText({
        apiKey: payload.settings.apiKey,
        messages: messagesForApi
      });
      const assistantRow = await apiCreateMessage({
        chat_id: payload.currentChatId,
        role: 'assistant',
        content: [{ type: 'text', text: assistantContent }]
      });
      return { userRow, assistantRow }; 
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.currentChatId] });
      resetForm();
    },
    onError: (error, variables) => {
      Toast(`Error sending message: ${error.message}`, 8000);
      console.error("Send message error:", error);
      queryClient.invalidateQueries({ queryKey: ['messages', variables.currentChatId] });
    }
  });

  const undoDeleteMessageMutation = useMutation({
    mutationFn: (messageId) => apiUndoDeleteMessage(messageId),
    onSuccess: (data, messageId) => {
      // Invalidate to refetch and show the un-deleted message
      queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
      Toast('Message restored.', 2000);
    },
    onError: (error) => {
      Toast('Failed to undo message delete: ' + error.message, 5000);
    }
  });

  const deleteMessageMutation = useMutation({
    mutationFn: (messageId) => apiDeleteMessage(messageId),
    onMutate: async (messageId) => {
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['messages', currentChatId] });
      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData(['messages', currentChatId]);
      // Optimistically remove the message
      queryClient.setQueryData(['messages', currentChatId], (oldMessages = []) =>
        oldMessages.filter(msg => msg.id !== messageId)
      );
      // Return a context object with the snapshotted value
      return { previousMessages, messageId };
    },
    onSuccess: (data, messageId, context) => {
      Toast('Message deleted.', 15000, () => { // 15 second Toast duration
        undoDeleteMessageMutation.mutate(context.messageId);
      });
    },
    onError: (err, messageId, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousMessages) {
        queryClient.setQueryData(['messages', currentChatId], context.previousMessages);
      }
      Toast('Failed to delete message: ' + err.message, 5000);
    },
    onSettled: () => {
      // Always refetch after error or success (unless undo is hit quickly) to ensure server state
      // This might be too aggressive if undo is common. Consider if needed or if optimistic + undo is enough.
      // queryClient.invalidateQueries({ queryKey: ['messages', currentChatId] });
    }
  });

  const busy = useMemo(() => 
    createChatMutation.isPending || 
    deleteChatMutation.isPending || 
    sendMessageMutation.isPending ||
    updateChatTitleMutation.isPending ||
    deleteMessageMutation.isPending ||
    undoDeleteMessageMutation.isPending || // Added
    isCountingApiTokens,
  [
    createChatMutation.isPending, 
    deleteChatMutation.isPending,
    sendMessageMutation.isPending,
    updateChatTitleMutation.isPending,
    deleteMessageMutation.isPending,
    undoDeleteMessageMutation.isPending, // Added
    isCountingApiTokens
  ]);

  useEffect(() => () => { pendingImages.forEach(revokeOnce); }, [pendingImages]);

  const callWorkerForTokenCount = useCallback((currentItemsForApi, currentApiKey, currentModel) => {
      // ... (callWorkerForTokenCount - no changes) ...
    const currentVersion = ++tokenCountVersionRef.current;
    if (!currentApiKey || String(currentApiKey).trim() === "") {
        if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(false); setApiCalculatedTokenCount(0); } return;
    }
    if (currentItemsForApi.length === 0) {
        if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(0); setIsCountingApiTokens(false); } return;
    }
    if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(true); } else { return; }
    
    countTokensWithGemini(currentApiKey, currentModel, currentItemsForApi)
        .then(count => {
            if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(count); }
        })
        .catch(error => {
            console.warn("Token counting error:", error);
            if (tokenCountVersionRef.current === currentVersion) { setApiCalculatedTokenCount(0); }
        })
        .finally(() => {
            if (tokenCountVersionRef.current === currentVersion) { setIsCountingApiTokens(false); }
        });
  }, []);

  useEffect(() => {
      // ... (token counting useEffect - no changes) ...
    if (!debouncedApiCallRef.current) {
        debouncedApiCallRef.current = debounce(callWorkerForTokenCount, 750);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTokenCount]);

  // --- Action Handlers to pass to Child Components ---
  const handleNewChatTrigger = useCallback((data = {}) => { /* ... (no changes) ... */ 
    if (createChatMutation.isPending) return;
    createChatMutation.mutate({ title: data.title || 'New Chat', model: data.model || GEMINI_MODEL_NAME });
  }, [createChatMutation]);

  const handleDeleteChatTrigger = useCallback((id) => { /* ... (no changes, confirm can be added here or in ChatItem) ... */
    if (deleteChatMutation.isPending) return;
    deleteChatMutation.mutate(id);
  }, [deleteChatMutation]);

  const handleUpdateChatTitleTrigger = useCallback((id, title) => { /* ... (no changes) ... */
    if (updateChatTitleMutation.isPending) return;
    updateChatTitleMutation.mutate({ id, title });
  }, [updateChatTitleMutation]);

  function resetForm() { /* ... (no changes) ... */
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]);
    setForm(INITIAL_FORM_DATA);
  }

  function handleSend() { /* ... (no changes) ... */
    if (sendMessageMutation.isPending || !currentChatId) {
      if(!currentChatId) Toast("Please select or create a chat first.", 3000);
      return;
    }
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
      existingMessages: currentChatMessages,
    });
  }
  
  function handleStartEdit(msg) { /* ... (no changes) ... */
    setEditing(msg.id); 
    const textContent = Array.isArray(msg.content) 
      ? msg.content.find(b => b.type === 'text')?.text || '' 
      : String(msg.content || '');
    setEditText(textContent);
  }
  function handleCancelEdit() { /* ... (no changes) ... */ setEditing(null); setEditText(''); }
  
  async function handleSaveEdit() { /* ... (TODO: TQ mutation) ... */
    if (!editingId || !currentChatId) return; 
    Toast('Save edit: Not fully implemented yet with TQ.', 3000);
    setEditing(null); 
    setEditText(''); 
  }
  
  function handleResendMessage(messageId) { /* ... (TODO: TQ mutation) ... */
    if (!currentChatId) return;
    Toast('Resend: Not fully implemented yet with TQ.', 3000);
  }

  const handleDeleteMessageTrigger = useCallback((messageId) => {
    if (deleteMessageMutation.isPending || !currentChatId) return;
    // Confirmation could be here or in ChatArea/MessageItem
    deleteMessageMutation.mutate(messageId);
  }, [deleteMessageMutation, currentChatId]);


  const scrollToPrev = useCallback(() => { /* ... (no changes) ... */
    const box = chatContainerRef.current; if (!box) return;
    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;
    const viewportTop = box.scrollTop;
    let targetScroll = 0;
    for (let i = messagesInView.length - 1; i >= 0; i--) {
        const msg = messagesInView[i];
        if (msg.offsetTop < viewportTop - 10) { 
            targetScroll = msg.offsetTop;
            break; 
        }
    }
    box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);

  const scrollToNext = useCallback(() => { /* ... (no changes) ... */
    const box = chatContainerRef.current; if (!box) return;
    const viewportBottom = box.scrollTop + box.clientHeight;
    if (box.scrollHeight - viewportBottom < 50) { 
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        return;
    }
    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;
    let targetScroll = box.scrollHeight;
    for (let i = 0; i < messagesInView.length; i++) {
        const msg = messagesInView[i];
        if (msg.offsetTop >= viewportBottom) {
            targetScroll = msg.offsetTop;
            break;
        }
    }
     box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);
  
  const handleCopyAll = () => { /* ... (no changes) ... */
    const txt = currentChatMessages.map(m => {
      const contentArray = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      return contentArray.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(txt)
      .then(() => Toast('Copied all text to clipboard!', 2000))
      .catch(() => Toast('Copy failed (clipboard API)', 4000));
  };

  const totalPromptTokenCount = useMemo(() => { /* ... (no changes) ... */
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

  return (
    <div className="app-container">
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={setCurrentChatId}
        onNewChatTrigger={handleNewChatTrigger}
        onDeleteChatTrigger={handleDeleteChatTrigger}
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger}
        appDisabled={busy}
      />
      <div className="main-content">
        {/* ... (Top bar and settings panel - no changes other than token display) ... */}
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{margin:'0 1em',fontWeight:'bold'}}>Konzuko AI</span>
          <div style={{marginLeft:'auto',display:'flex',gap:'0.5em', alignItems: 'center'}}>
            <div className="token-count-display">
              Tokens: {totalPromptTokenCount.toLocaleString()}
            </div>
            <button className="button" onClick={handleCopyAll} disabled={!currentChatMessages || currentChatMessages.length === 0}>Copy All Text</button>
          </div>
        </div>
        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label htmlFor="apiKeyInputApp">Gemini API Key (Google AI Studio):</label>
              <input
                id="apiKeyInputApp"
                className="form-input"
                type="password"
                value={settings.apiKey}
                onInput={e => setSettings(s => ({ ...s, apiKey:e.target.value }))}
                placeholder="Enter your Gemini API Key"
              />
            </div>
            <div className="form-group">
              <label htmlFor="modelInputApp">Model:</label>
              <input
                id="modelInputApp"
                className="form-input"
                value={GEMINI_MODEL_NAME}
                readOnly
              />
            </div>
          </div>
        )}
        <div className="content-container">
          <div className="chat-container" ref={chatContainerRef}>
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up">↑</button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down">↓</button>
            </div>
            {/* ... (ChatArea rendering logic - no changes) ... */}
            {isLoadingMessages && currentChatId && <div className="chat-loading-placeholder">Loading messages...</div>}
            {!isLoadingMessages && currentChatId && currentChatMessages?.length > 0 && (
              <ChatArea
                messages={currentChatMessages}
                editingId={editingId}
                editText={editText}
                loadingSend={sendMessageMutation.isPending}
                savingEdit={false /* TODO: editMutation.isPending */}
                setEditText={setEditText}
                handleSaveEdit={handleSaveEdit}
                handleCancelEdit={handleCancelEdit}
                handleStartEdit={handleStartEdit}
                handleResendMessage={handleResendMessage}
                handleDeleteMessage={handleDeleteMessageTrigger}
              />
            )}
            {!isLoadingMessages && currentChatId && currentChatMessages?.length === 0 && (
                <div className="chat-empty-placeholder">No messages in this chat yet. Send one!</div>
            )}
            {!currentChatId && <div className="chat-empty-placeholder">Select or create a chat to begin.</div>}
          </div>
          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode} setMode={setMode}
              form={form} setForm={setForm}
              loadingSend={sendMessageMutation.isPending}
              handleSend={handleSend}
              showToast={Toast}
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

