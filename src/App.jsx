// src/App.jsx
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
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
    updateChatTitle: mutateUpdateChatTitle, // Renamed to avoid confusion with the handler
    isLoadingSession,
    isCreatingChat,
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
    isLoadingOps: isLoadingMessageOps,
    isSavingEdit,
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


  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const chatContainerRef = useRef(null);

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


  const globalBusy = useMemo(() =>
    isLoadingSession || isLoadingMessageOps,
    [isLoadingSession, isLoadingMessageOps]
  );

  const promptBuilderLoadingSend = useMemo(() =>
    isLoadingMessageOps,
    [isLoadingMessageOps]
  );


  useEffect(() => {
    if (currentChatId !== previousChatIdRef.current) {
      if (editingId) cancelEdit();
      resetPrompt();
      handleProjectRootChange(null);
    }
    previousChatIdRef.current = currentChatId;
  }, [currentChatId, editingId, cancelEdit, resetPrompt, handleProjectRootChange]);


  function handleSend() {
    if (promptBuilderLoadingSend || globalBusy) {
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

  const scrollToPrev = useCallback(() => {
    const box = chatContainerRef.current; if (!box) return;
    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;
    const viewportTop = box.scrollTop;
    let targetScroll = 0;
    for (let i = messagesInView.length - 1; i >= 0; i--) {
      const msg = messagesInView[i];
      if (msg.offsetTop < viewportTop - 10) { targetScroll = msg.offsetTop; break; }
    }
    box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);

  const scrollToNext = useCallback(() => {
    const box = chatContainerRef.current; if (!box) return;
    const viewportBottom = box.scrollTop + box.clientHeight;
    if (box.scrollHeight - viewportBottom < 50) {
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); return;
    }
    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;
    let targetScroll = box.scrollHeight;
    for (let i = 0; i < messagesInView.length; i++) {
      const msg = messagesInView[i];
      if (msg.offsetTop >= viewportBottom) { targetScroll = msg.offsetTop; break; }
    }
    box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);

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

  // Handler function to correctly call the mutation
  const handleUpdateChatTitleTrigger = useCallback((id, title) => {
    if (!id) {
        console.error("handleUpdateChatTitleTrigger called with undefined id");
        Toast("Error: Could not update title due to missing ID.", 4000);
        return;
    }
    mutateUpdateChatTitle({ id, title });
  }, [mutateUpdateChatTitle]);


  return (
    <div className="app-container">
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={setCurrentChatId}
        onNewChatTrigger={createChat}
        onDeleteChatTrigger={deleteChat}
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger} // Pass the new handler
        appDisabled={globalBusy || isCreatingChat}
      />
      <div className="main-content">
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setSettings(s => ({ ...s, showSettings: !s.showSettings }))}
            disabled={globalBusy}
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>Konzuko AI</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5em', alignItems: 'center' }}>
            <div className="token-count-display">
              Tokens: {totalPromptTokenCount.toLocaleString()}
              {isCountingApiTokens && <span style={{ marginLeft: '5px', fontStyle: 'italic' }}>(...)</span>}
            </div>
            <button className="button" onClick={handleCopyAll} disabled={!messages || messages.length === 0 || globalBusy}>Copy All Text</button>
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
          <div className="chat-container" ref={chatContainerRef}>
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up" disabled={globalBusy}>↑</button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down" disabled={globalBusy}>↓</button>
            </div>
            {isLoadingMessages && currentChatId && <div className="chat-loading-placeholder">Loading messages...</div>}
            {!isLoadingMessages && currentChatId && messages?.length > 0 && (
              <ChatArea
                messages={messages}
                editingId={editingId}
                editText={editText}
                loadingSend={promptBuilderLoadingSend}
                savingEdit={isSavingEdit}
                setEditText={setEditText}
                handleSaveEdit={saveEdit}
                handleCancelEdit={cancelEdit}
                handleStartEdit={startEdit}
                handleResendMessage={resendMessage}
                handleDeleteMessage={deleteMessage}
                actionsDisabled={globalBusy}
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
              loadingSend={promptBuilderLoadingSend}
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
