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
import { 
    IMAGE_TOKEN_ESTIMATE, 
    USER_FACING_TOKEN_LIMIT, 
    MAX_ABSOLUTE_TOKEN_LIMIT 
} from './config.js'; 

import { useSettings } from './hooks.js';
import { useChatSessionManager } from './hooks/useChatSessionManager.js';
import { useMessageManager } from './hooks/useMessageManager.js';
import { usePromptBuilder } from './hooks/usePromptBuilder.js'; 
import { useScrollNavigation } from './hooks/useScrollNavigation.js';

import { useTokenizableContent } from './hooks/useTokenizableContent.js';
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
  const inFlightSendSnapshotMarkerRef = useRef(null); 
  const [isSwitchingChat, setIsSwitchingChat] = useState(false); 
  const [isAppGloballySending, setIsAppGloballySending] = useState(false);

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
  } = useMessageManager(currentChatId, settings.apiKey, setIsAppGloballySending); 

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

  const handleSelectChat = useCallback(
    (newChatId) => {
      if (newChatId === currentChatId && !isSwitchingChat) return; 
      if (isSwitchingChat && newChatId === currentChatId) return; 
      if (isAppGloballySending) {
        Toast("An operation is in progress. Please wait.", 3000); 
        return;
      }
      setIsSwitchingChat(true);
      originalSetCurrentChatId(newChatId);
    },
    [currentChatId, originalSetCurrentChatId, isSwitchingChat, isAppGloballySending]
  );

  const [totalApiTokenCount, setTotalApiTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const itemsForApiCount = useTokenizableContent(
    messages,
    userPromptText, 
    pendingPDFs,
    isAppGloballySending 
  );

  const callWorkerForTotalTokenCount = useCallback(
    (currentItemsForApi, apiKey, model) => {
      const currentVersion = ++tokenCountVersionRef.current;
      if (!apiKey || String(apiKey).trim() === "" || !currentItemsForApi || currentItemsForApi.length === 0) {
        if (tokenCountVersionRef.current === currentVersion) {
          setTotalApiTokenCount(0);
          setIsCountingApiTokens(false);
        }
        return;
      }
      if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(true);
      else return; 

      countTokensWithGemini(apiKey, model, currentItemsForApi)
        .then(count => { 
          if (tokenCountVersionRef.current === currentVersion) setTotalApiTokenCount(count); 
        })
        .catch(error => {
          console.warn("Total token counting error:", error);
          if (tokenCountVersionRef.current === currentVersion) setTotalApiTokenCount(0);
        })
        .finally(() => { 
          if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(false); 
        });
    },
    []
  );

  useEffect(() => {
    if (!debouncedApiCallRef.current) {
      debouncedApiCallRef.current = debounce(callWorkerForTotalTokenCount, 1500);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTotalTokenCount]);

  const currentTotalPromptTokens = useMemo(() => {
    let estimatedImageTokens = 0;
    if (!isAppGloballySending) { 
      estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    }
    (messages || []).forEach(msg => {
      const contentBlocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: 'text', text: String(msg.content ?? '') }];
      contentBlocks.forEach(block => {
        if (block.type === 'image_url' && block.image_url?.url) {
          estimatedImageTokens += IMAGE_TOKEN_ESTIMATE;
        }
      });
    });
    return totalApiTokenCount + estimatedImageTokens;
  }, [totalApiTokenCount, pendingImages, messages, isAppGloballySending]);

  const isSoftMemoryLimitReached = currentTotalPromptTokens >= USER_FACING_TOKEN_LIMIT;
  const isHardTokenLimitReached = currentTotalPromptTokens >= MAX_ABSOLUTE_TOKEN_LIMIT;

  const chatListDisabled = useMemo(
    () => isCreatingChat || isSwitchingChat || isAppGloballySending,
    [isCreatingChat, isSwitchingChat, isAppGloballySending]
  );

  const globalBusy = useMemo(
    () => isLoadingSession || isSwitchingChat || isAppGloballySending,
    [isLoadingSession, isSwitchingChat, isAppGloballySending]
  );

  // New memoized state specifically for disabling the nav rail
  const navRailDisabled = useMemo(
    () => isLoadingSession || isSwitchingChat,
    [isLoadingSession, isSwitchingChat]
  );
  
  const chatAreaActionsDisabled = useMemo(
    () => isLoadingMessageOps || isLoadingSession || isSwitchingChat || isAppGloballySending,
    [isLoadingMessageOps, isLoadingSession, isSwitchingChat, isAppGloballySending]
  );

  const sendButtonDisplayInfo = useMemo(() => {
    if (isAppGloballySending) {
      if (isSendingMessage) return { text: 'Sending…', disabled: true };
      if (isSavingEdit) return { text: 'Saving…', disabled: true };
      if (isResendingMessage) return { text: 'Resending…', disabled: true };
      return { text: 'Processing…', disabled: true }; 
    }
    
    if (!settings.apiKey) return { text: 'Set API Key', disabled: false };
    if (!currentChatId) return { text: 'Select Chat', disabled: false }; 
    if (isHardTokenLimitReached) return { text: 'Token Limit Exceeded', disabled: true };
        
    return { text: 'Send', disabled: false };
  }, [
    isAppGloballySending,
    isSendingMessage, 
    isSavingEdit,     
    isResendingMessage, 
    settings.apiKey, 
    currentChatId, 
    isHardTokenLimitReached, 
  ]);

  const finalSendButtonDisabled = sendButtonDisplayInfo.disabled || globalBusy;


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
    let cleanupRaf, scrollRaf, transitionEndRaf;

    if (currentChatId !== previousChatIdRef.current) {
      inFlightSendSnapshotMarkerRef.current = null; 
      cleanupRaf = requestAnimationFrame(() => {
        if (editingId) cancelEdit(); 
      });
      if (currentChatId) { 
        scrollRaf = requestAnimationFrame(() => scrollToBottom('auto'));
      }
      if (isSwitchingChat) { 
        transitionEndRaf = requestAnimationFrame(() => setIsSwitchingChat(false));
      }
      previousChatIdRef.current = currentChatId;
    }
    return () => {
      if (cleanupRaf) cancelAnimationFrame(cleanupRaf); 
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (transitionEndRaf) cancelAnimationFrame(transitionEndRaf);
    };
  }, [currentChatId, isSwitchingChat, editingId, cancelEdit, scrollToBottom]); 
  
  function handleSend() {
    if (isAppGloballySending) { 
        Toast("An operation is already in progress. Please wait.", 3000);
        return;
    }
    if (isHardTokenLimitReached) {
        Toast(`Prompt too large (max ${MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()} tokens). Please reduce content.`, 8000);
        return;
    }

    if (!currentChatId) {
      Toast('Please select or create a chat first.', 3000);
      return;
    }
    if (!settings.apiKey || String(settings.apiKey).trim() === '') {
      Toast('Gemini API Key missing. Please set it in settings.', 5000);
      setSettings((s) => ({ ...s, showSettings: true }));
      return;
    }

    const userMessageContentBlocks = [];
    pendingPDFs.forEach((p) =>
      userMessageContentBlocks.push({
        type: 'file',
        file: {
          file_id: p.fileId,
          original_name: p.name,
          mime_type: p.mimeType,
        },
      })
    );
    pendingImages.forEach((img) =>
      userMessageContentBlocks.push({
        type: 'image_url',
        image_url: {
          url: img.url,
          detail: 'high',
          original_name: img.name,
        },
      })
    );
    if (userPromptText?.trim()) {
      userMessageContentBlocks.push({ type: 'text', text: userPromptText });
    }

    if (userMessageContentBlocks.length === 0) {
      Toast('Cannot send an empty message.', 3000);
      return;
    }

    const onSendSuccess = () => {
      inFlightSendSnapshotMarkerRef.current = null;
    };

    sendMessage({
      userMessageContentBlocks,
      existingMessages: messages,
      onSendSuccess: onSendSuccess, 
    });

    resetPrompt();
  }

  const handleCopyAll = () => {
    const txt = messages
      .map((m) => {
        const blocks = Array.isArray(m.content)
          ? m.content
          : [{ type: 'text', text: String(m.content ?? '') }];
        return blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      })
      .join('\n\n');
    navigator.clipboard
      .writeText(txt)
      .then(() => Toast('Copied all text!', 2000))
      .catch(() => Toast('Copy failed.', 4000));
  };

  const handleUpdateChatTitleTrigger = useCallback(
    (id, title) => {
      if (isAppGloballySending) {
          Toast("Cannot update title while an operation is in progress.", 3000);
          return;
      }
      if (!id) {
        console.error('handleUpdateChatTitleTrigger called with undefined id');
        Toast('Error: Could not update title.', 4000);
        return;
      }
      updateChatTitle({ id, title });
    },
    [updateChatTitle, isAppGloballySending] 
  );

  const handleNewChatTrigger = useCallback(() => {
    if (isAppGloballySending) {
        Toast("Cannot create new chat while an operation is in progress.", 3000);
        return;
    }
    createChat();
  }, [createChat, isAppGloballySending]);

  const handleDeleteChatTrigger = useCallback((chatId) => {
    if (isAppGloballySending) {
        Toast("Cannot delete chat while an operation is in progress.", 3000);
        return;
    }
    deleteChat(chatId);
  }, [deleteChat, isAppGloballySending]);


  return (
    <div className="app-container">
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChatTrigger={handleNewChatTrigger} 
        onDeleteChatTrigger={handleDeleteChatTrigger} 
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger}
        appDisabled={chatListDisabled} 
      />

      <div className="main-content">
        <div className="top-bar">
          <button
            className="button"
            onClick={() =>
              setSettings((s) => ({ ...s, showSettings: !s.showSettings }))
            }
            disabled={globalBusy} 
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>

          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>
            Konzuko&nbsp;AI {isAppGloballySending && 
              (isSendingMessage ? "(Sending...)" : 
               isSavingEdit ? "(Saving...)" : 
               isResendingMessage ? "(Resending...)" : 
               "(Processing...)")
            }
          </span>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: '0.5em',
              alignItems: 'center',
            }}
          >
            {isSoftMemoryLimitReached && (
              <div
                style={{
                  color: isHardTokenLimitReached
                    ? 'var(--error)'
                    : 'var(--warning)',
                  fontWeight: 'bold',
                  padding: 'var(--space-xs) var(--space-sm)',
                  border: `1px solid ${
                    isHardTokenLimitReached ? 'var(--error)' : 'var(--warning)'
                  }`,
                  borderRadius: 'var(--radius)',
                  marginRight: 'var(--space-sm)',
                }}
              >
                {isHardTokenLimitReached
                  ? 'MAX\u00A0TOKENS\u00A0REACHED' 
                  : 'MEMORY\u00A0AT\u00A0LIMIT'}
              </div>
            )}

            <div
              className="token-count-display"
              style={
                isHardTokenLimitReached
                  ? {
                      color: 'var(--error)',
                      fontWeight: 'bold',
                      border: '1px solid var(--error)',
                    }
                  : {}
              }
            >
              Tokens:&nbsp; 
              {currentTotalPromptTokens.toLocaleString()} /{' '}
              {USER_FACING_TOKEN_LIMIT.toLocaleString()}
              {isHardTokenLimitReached && (
                <span style={{ marginLeft: 4 }}>
                  {' '}
                  (Max&nbsp; 
                  {MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()})
                </span>
              )}
              {isCountingApiTokens && (
                <span style={{ marginLeft: 5, fontStyle: 'italic' }}>
                  (...)
                </span>
              )}
            </div>

            <button
              className="button"
              onClick={handleCopyAll}
              disabled={
                !messages ||
                messages.length === 0 ||
                globalBusy || 
                isLoadingMessageOps 
              }
            >
              Copy All Text
            </button>
          </div>
        </div>

        {settings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label htmlFor="apiKeyInputApp">
                Gemini API Key (Google AI Studio):
              </label>
              <input
                id="apiKeyInputApp"
                className="form-input"
                type="password"
                value={settings.apiKey}
                onInput={(e) =>
                  setSettings((s) => ({ ...s, apiKey: e.target.value }))
                }
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
              <button
                className="button icon-button"
                onClick={scrollToPrev}
                title="Scroll Up"
                disabled={navRailDisabled} 
              >
                ↑
              </button>
              <button
                className="button icon-button"
                onClick={scrollToNext}
                title="Scroll Down"
                disabled={navRailDisabled} 
              >
                ↓
              </button>
            </div>

            {currentChatId ? (
              <ChatArea
                key={currentChatId}
                messages={messages}
                isLoading={isLoadingMessages}
                forceLoading={isSwitchingChat}
                editingId={editingId}
                editText={editText}
                loadingSend={isAppGloballySending} 
                savingEdit={isAppGloballySending && isSavingEdit} 
                setEditText={setEditText}
                handleSaveEdit={saveEdit}
                handleCancelEdit={cancelEdit}
                handleStartEdit={startEdit}
                handleResendMessage={resendMessage}
                handleDeleteMessage={deleteMessage}
                actionsDisabled={chatAreaActionsDisabled} 
              />
            ) : (
              <div className="chat-empty-placeholder">
                Select or create a chat to begin.
              </div>
            )}
          </div>

          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              sendDisabled={finalSendButtonDisabled} 
              sendButtonText={sendButtonDisplayInfo.text} 
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
              currentChatId={currentChatId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

