// src/App.jsx
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback
} from 'preact/hooks';

import ChatList from './ChatList.jsx';
import PromptBuilder from './PromptBuilder.jsx';
import ChatArea from './components/ChatArea.jsx';
import Toast from './components/Toast.jsx';

import { GEMINI_MODEL_NAME } from './api.js';

import { useSettings } from './hooks.js';
import { useChatSessionManager } from './hooks/useChatSessionManager.js';
import { useMessageManager } from './hooks/useMessageManager.js';
import { usePromptBuilder } from './hooks/usePromptBuilder.js';
import { useScrollNavigation } from './hooks/useScrollNavigation.js';

import { useTokenizableContent } from './hooks/useTokenizableContent.js';
import { IMAGE_TOKEN_ESTIMATE } from './config.js';
import { countTokensWithGemini } from './lib/tokenWorkerClient.js';


const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

export default function App() {
  const [settings, setSettings] = useSettings();
  const previousChatIdRef = useRef(null);

  const {
    currentChatId,
    setCurrentChatId,
    createChat,
    deleteChat,
    updateChatTitle,
    isLoadingSession, // True if chat list operations are happening (create, delete, rename)
    isCreatingChat,   // Specific state for new chat button
  } = useChatSessionManager();

  const {
    messages,
    isLoadingMessages,
    editingId,
    editText,
    setEditText,
    startEdit,
    cancelEdit,
    saveEdit,
    sendMessage,
    resendMessage,
    deleteMessage,
    isLoadingOps: isLoadingMessageOps, // True if any message operation is in progress
    isSendingMessage, // Specific state for send button in PromptBuilder
    isSavingEdit,     // Specific state for save button in ChatArea
    // isResendingMessage, // Can be added if needed for specific UI
    // isDeletingMessage,  // Can be added if needed for specific UI
  } = useMessageManager(currentChatId, settings.apiKey);

  const {
    form,
    setForm,
    mode,
    setMode,
    pendingImages,
    addPendingImage,
    removePendingImage,
    pendingPDFs,
    addPendingPDF,
    pendingFiles,
    setPendingFiles,
    currentProjectRootName,
    handleProjectRootChange,
    userPromptText,
    resetPrompt,
  } = usePromptBuilder();

  const {
    scrollContainerRef,
    scrollToPrev,
    scrollToNext,
    scrollToBottom,
  } = useScrollNavigation();


  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);


  const itemsForApiCount = useTokenizableContent(
    messages,
    userPromptText,
    pendingPDFs
  );

   const callWorkerForTokenCount = useCallback((currentItemsForApi, currentApiKey, currentModel) => {
    const currentVersion = ++tokenCountVersionRef.current;
    if (!currentApiKey || String(currentApiKey).trim() === "") {
      if (tokenCountVersionRef.current === currentVersion) {
        setIsCountingApiTokens(false); setApiCalculatedTokenCount(0);
      } return;
    }
    if (currentItemsForApi.length === 0) {
      if (tokenCountVersionRef.current === currentVersion) {
        setApiCalculatedTokenCount(0); setIsCountingApiTokens(false);
      } return;
    }
    if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(true);
    else return;

    countTokensWithGemini(currentApiKey, currentModel, currentItemsForApi)
      .then(count => { if (tokenCountVersionRef.current === currentVersion) setApiCalculatedTokenCount(count); })
      .catch(error => {
        console.warn("Token counting error:", error);
        if (tokenCountVersionRef.current === currentVersion) setApiCalculatedTokenCount(0);
      })
      .finally(() => { if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(false); });
  }, []);

  useEffect(() => {
    if (!debouncedApiCallRef.current) {
      debouncedApiCallRef.current = debounce(callWorkerForTokenCount, 750);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTokenCount]);

  // globalBusy should reflect operations that make the *entire app* or major sections unstable for interaction.
  // Chat list operations (isLoadingSession) fit this.
  // Individual message operations (isLoadingMessageOps) might not need to block everything.
  const globalBusy = useMemo(() =>
    isLoadingSession, // Only disable global things if chat session ops are in progress
    [isLoadingSession]
  );

  // This specifically controls the "Send" button in PromptBuilder
  const promptBuilderLoadingSend = useMemo(() =>
    isSendingMessage, // Use the specific flag from useMessageManager
    [isSendingMessage]
  );

  // This controls actions within ChatArea (edit, resend, delete message buttons)
  const chatAreaActionsDisabled = useMemo(() =>
    isLoadingMessageOps || isLoadingSession, // Disable if any message op OR session op is happening
    [isLoadingMessageOps, isLoadingSession]
  );


  useEffect(() => {
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'assistant' || (lastMessage.role === 'user' && !editingId)) {
            const box = scrollContainerRef.current;
            if (box && (box.scrollHeight - box.scrollTop - box.clientHeight > 100)) {
                // User has scrolled up significantly, don't auto-scroll
            } else {
                scrollToBottom('smooth');
            }
        }
    }
  }, [messages, editingId, scrollToBottom, scrollContainerRef]);


  useEffect(() => {
    if (currentChatId !== previousChatIdRef.current) {
      if (editingId) cancelEdit();
      resetPrompt();
      handleProjectRootChange(null);
      if (previousChatIdRef.current !== null) {
        setTimeout(() => scrollToBottom('auto'), 0);
      }
    }
    previousChatIdRef.current = currentChatId;
  }, [currentChatId, editingId, cancelEdit, resetPrompt, handleProjectRootChange, scrollToBottom]);


  function handleSend() {
    // Use promptBuilderLoadingSend for this specific action
    if (promptBuilderLoadingSend || globalBusy) { // globalBusy check here is okay as sending is a major action
      if (!currentChatId) Toast("Please select or create a chat first.", 3000);
      return;
    }
    if (!currentChatId) {
      Toast("Please select or create a chat first.", 3000);
      return;
    }
    if (!settings.apiKey || String(settings.apiKey).trim() === "") {
      Toast("Gemini API Key is missing. Please set it in settings.", 5000);
      setSettings(s => ({ ...s, showSettings: true }));
      return;
    }

    const userMessageContentBlocks = [];
    pendingPDFs.forEach(p => userMessageContentBlocks.push({
      type: 'file', file: { file_id: p.fileId, original_name: p.name, mime_type: p.mimeType }
    }));
    pendingImages.forEach(img => userMessageContentBlocks.push({
      type: 'image_url', image_url: { url: img.url, detail: 'high', original_name: img.name }
    }));
    if (userPromptText && userPromptText.trim() !== "") {
      userMessageContentBlocks.push({ type: 'text', text: userPromptText });
    }

    if (userMessageContentBlocks.length === 0) {
      Toast("Cannot send an empty message.", 3000);
      return;
    }

    sendMessage({
      userMessageContentBlocks,
      existingMessages: messages,
    });
    resetPrompt();
  }


  const handleCopyAll = () => {
    const txt = messages.map(m => {
      const contentArray = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }];
      return contentArray.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }).join('\n\n');
    navigator.clipboard.writeText(txt)
      .then(() => Toast('Copied all text to clipboard!', 2000))
      .catch(() => Toast('Copy failed (clipboard API)', 4000));
  };

  const totalPromptTokenCount = useMemo(() => {
    let estimatedImageTokens = 0;
    estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    (messages || []).forEach(msg => {
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
  }, [apiCalculatedTokenCount, pendingImages, messages]);

  const handleUpdateChatTitleTrigger = useCallback((id, title) => {
    if (!id) {
        console.error("handleUpdateChatTitleTrigger called with undefined id");
        Toast("Error: Could not update title due to missing ID.", 4000);
        return;
    }
    updateChatTitle({ id, title });
  }, [updateChatTitle]);


  return (
    <div className="app-container">
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={setCurrentChatId}
        onNewChatTrigger={createChat}
        onDeleteChatTrigger={deleteChat}
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger}
        // ChatList is disabled if session operations are happening or a new chat is specifically being created.
        // It's NOT disabled if only a message is sending within the current chat.
        appDisabled={isLoadingSession || isCreatingChat}
      />
      <div className="main-content">
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
            disabled={globalBusy} // Settings button can be disabled by globalBusy (session ops)
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>Konzuko AI</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5em', alignItems: 'center' }}>
            <div className="token-count-display">
              Tokens: {totalPromptTokenCount.toLocaleString()}
              {isCountingApiTokens && <span style={{ marginLeft: '5px', fontStyle: 'italic' }}>(...)</span>}
            </div>
            {/* Copy All Text button can be disabled by globalBusy (session ops) or if message ops are happening */}
            <button className="button" onClick={handleCopyAll} disabled={!messages || messages.length === 0 || globalBusy || isLoadingMessageOps }>Copy All Text</button>
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
                onInput={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
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
          <div className="chat-container" ref={scrollContainerRef}>
            <div className="chat-nav-rail">
              {/* Scroll buttons are NOT disabled by message sending, only by session operations */}
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up" disabled={isLoadingSession}>↑</button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down" disabled={isLoadingSession}>↓</button>
            </div>
            {isLoadingMessages && currentChatId && <div className="chat-loading-placeholder">Loading messages...</div>}
            {!isLoadingMessages && currentChatId && messages?.length > 0 && (
              <ChatArea
                messages={messages}
                editingId={editingId}
                editText={editText}
                // loadingSend for ChatArea's internal "Resend" button (if it were separate)
                // For now, the main "Send" is in PromptBuilder.
                // Individual message actions (edit, resend, delete) are controlled by chatAreaActionsDisabled.
                loadingSend={isSendingMessage} // Or a more specific isResending for its own resend
                savingEdit={isSavingEdit}
                setEditText={setEditText}
                handleSaveEdit={saveEdit}
                handleCancelEdit={cancelEdit}
                handleStartEdit={startEdit}
                handleResendMessage={resendMessage}
                handleDeleteMessage={deleteMessage}
                actionsDisabled={chatAreaActionsDisabled} // Use the more granular disabling
              />
            )}
            {!isLoadingMessages && currentChatId && messages?.length === 0 && (
              <div className="chat-empty-placeholder">No messages in this chat yet. Send one!</div>
            )}
            {!currentChatId && <div className="chat-empty-placeholder">Select or create a chat to begin.</div>}
          </div>
          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              loadingSend={promptBuilderLoadingSend} // Specifically for the "Send" button
              handleSend={handleSend}
              showToast={Toast}
              imagePreviews={pendingImages}
              pdfPreviews={pendingPDFs}
              onRemoveImage={removePendingImage}
              onAddImage={addPendingImage}
              onAddPDF={addPendingPDF}
              settings={settings}
              pendingFiles={pendingFiles}
              onFilesChange={setPendingFiles}
              onProjectRootChange={handleProjectRootChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
