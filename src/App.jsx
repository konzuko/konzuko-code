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
  const sentPromptStateRef = useRef(null); 
  const [isSwitchingChat, setIsSwitchingChat] = useState(false); 

  const {
    currentChatId,
    setCurrentChatId: originalSetCurrentChatId, 
    createChat,
    deleteChat,
    updateChatTitle,
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
    isSendingMessage, 
    isSavingEdit,
    isResendingMessage, 
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

  const handleSelectChat = useCallback((newChatId) => {
    if (newChatId === currentChatId && !isSwitchingChat) return; // Avoid re-triggering if already selected and not in switch
    if (isSwitchingChat && newChatId === currentChatId) return; // Avoid re-triggering if already switching to this ID

    setIsSwitchingChat(true);
    originalSetCurrentChatId(newChatId);
  }, [currentChatId, originalSetCurrentChatId, isSwitchingChat]);


  const [apiCalculatedTokenCount, setApiCalculatedTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);


  const itemsForApiCount = useTokenizableContent(
    messages,
    userPromptText,
    pendingPDFs,
    isSendingMessage 
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
      // Updated debounce delay to 2000ms (2 seconds)
      debouncedApiCallRef.current = debounce(callWorkerForTokenCount, 2000);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTokenCount]);

  const chatListDisabled = useMemo(() => 
    isCreatingChat || isSwitchingChat, 
    [isCreatingChat, isSwitchingChat]
  );

  const globalBusy = useMemo(() =>
    isLoadingSession || isSwitchingChat, 
    [isLoadingSession, isSwitchingChat]
  );
  
  const chatAreaActionsDisabled = useMemo(() =>
    isLoadingMessageOps || isLoadingSession || isSwitchingChat, 
    [isLoadingMessageOps, isLoadingSession, isSwitchingChat]
  );

  const promptBuilderLoadingSend = useMemo(() =>
    isSendingMessage || isSavingEdit || isResendingMessage, 
    [isSendingMessage, isSavingEdit, isResendingMessage]
  );


  useEffect(() => {
    if (messages.length > 0 && currentChatId && !isSwitchingChat) { 
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'assistant' || (lastMessage.role === 'user' && !editingId)) {
            const box = scrollContainerRef.current;
            if (box && (box.scrollHeight - box.scrollTop - box.clientHeight > 100)) {
            } else {
                scrollToBottom('smooth');
            }
        }
    }
  }, [messages, editingId, scrollToBottom, scrollContainerRef, currentChatId, isSwitchingChat]);


  useEffect(() => {
    let cleanupRafId;
    let scrollRafId;
    let transitionEndRafId;

    // This effect should only run when currentChatId actually changes from its previous value.
    // The `isSwitchingChat` state handles the two-phase render.
    if (currentChatId !== previousChatIdRef.current) {
      // If isSwitchingChat is not yet true, it means handleSelectChat wasn't the trigger,
      // which could happen on initial load or if currentChatId is set externally.
      // In such cases, we might not need the full two-phase switching logic,
      // but deferring cleanup is still good.
      if (!isSwitchingChat && previousChatIdRef.current !== null) { // Check if it's a switch, not initial load
         // This case might need careful handling if currentChatId can be set by means other than handleSelectChat
         // For now, assume handleSelectChat is the primary way to switch.
      }

      sentPromptStateRef.current = null; 

      cleanupRafId = requestAnimationFrame(() => {
        if (editingId) { 
          cancelEdit();
        }
        resetPrompt(); 
      });

      if (currentChatId) { 
        scrollRafId = requestAnimationFrame(() => {
            scrollToBottom('auto'); 
        });
      }
      
      // This rAF ensures that isSwitchingChat is set to false *after*
      // the browser has had a chance to paint the initial forced loading state
      // and after other rAFs for cleanup/scroll are scheduled.
      // It should only run if isSwitchingChat was true.
      if (isSwitchingChat) {
        transitionEndRafId = requestAnimationFrame(() => {
            setIsSwitchingChat(false);
        });
      }
      
      previousChatIdRef.current = currentChatId;
    }
    return () => {
      if (cleanupRafId) cancelAnimationFrame(cleanupRafId); 
      if (scrollRafId) cancelAnimationFrame(scrollRafId);
      if (transitionEndRafId) cancelAnimationFrame(transitionEndRafId);
    };
  }, [currentChatId]); // Only currentChatId. Other values are stable or read within rAF.
                       // isSwitchingChat is managed by handleSelectChat and this effect.

  function handleSend() {
    if (promptBuilderLoadingSend || globalBusy) { 
      if (!currentChatId) Toast("Please select or create a chat first.", 3000);
      if (isSavingEdit) Toast("An edit is currently in progress. Please wait.", 3000);
      else if (isResendingMessage) Toast("A message is currently being resent. Please wait.", 3000);
      else if (isSendingMessage) Toast("A message is currently being sent. Please wait.", 3000);
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

    sentPromptStateRef.current = {
      userPromptText: userPromptText,
      pendingImages: [...pendingImages.map(img => ({ url: img.url, name: img.name }))],
      pendingPDFs: [...pendingPDFs.map(pdf => ({ fileId: pdf.fileId, name: pdf.name }))],
    };

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

    const onSendSuccessCallback = () => {
      const sentState = sentPromptStateRef.current;
      if (!sentState) { 
        resetPrompt();
        return;
      }

      const currentImagesComparable = pendingImages.map(img => ({ url: img.url, name: img.name }));
      const currentPDFsComparable = pendingPDFs.map(pdf => ({ fileId: pdf.fileId, name: pdf.name }));

      const textualContentChanged = userPromptText !== sentState.userPromptText;
      
      const imagesChanged = currentImagesComparable.length !== sentState.pendingImages.length ||
                           !currentImagesComparable.every((img, i) =>
                             sentState.pendingImages[i] &&
                             img.url === sentState.pendingImages[i].url &&
                             img.name === sentState.pendingImages[i].name
                           );
      const pdfsChanged = currentPDFsComparable.length !== sentState.pendingPDFs.length ||
                          !currentPDFsComparable.every((pdf, i) =>
                            sentState.pendingPDFs[i] &&
                            pdf.fileId === sentState.pendingPDFs[i].fileId &&
                            pdf.name === sentState.pendingPDFs[i].name
                          );

      if (!textualContentChanged && !imagesChanged && !pdfsChanged) {
        resetPrompt();
      }
      sentPromptStateRef.current = null; 
    };

    sendMessage({ 
      userMessageContentBlocks,
      existingMessages: messages,
      onSendSuccess: onSendSuccessCallback, 
    });
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
    
    if (!isSendingMessage) {
      estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    }

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
  }, [apiCalculatedTokenCount, pendingImages, messages, isSendingMessage]); 

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
        onSelectChat={handleSelectChat} 
        onNewChatTrigger={createChat}
        onDeleteChatTrigger={deleteChat}
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger}
        appDisabled={chatListDisabled}
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
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up" disabled={globalBusy}>↑</button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down" disabled={globalBusy}>↓</button>
            </div>
            {currentChatId ? (
              <ChatArea
                key={currentChatId} 
                messages={messages}
                isLoading={isLoadingMessages}
                forceLoading={isSwitchingChat} 
                editingId={editingId}
                editText={editText}
                loadingSend={isSendingMessage}
                savingEdit={isSavingEdit}
                setEditText={setEditText}
                handleSaveEdit={saveEdit}
                handleCancelEdit={cancelEdit}
                handleStartEdit={startEdit}
                handleResendMessage={resendMessage}
                handleDeleteMessage={deleteMessage}
                actionsDisabled={chatAreaActionsDisabled}
              />
            ) : (
              <div className="chat-empty-placeholder">Select or create a chat to begin.</div>
            )}
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
              promptBuilderRootName={currentProjectRootName} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}

