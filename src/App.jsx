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
  // const inFlightSendSnapshotMarkerRef = useRef(null); // Not clearly used, can be removed if confirmed
  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const [hasLastSendFailed, setHasLastSendFailed] = useState(false);
  const [isAppGloballySending, setIsAppGloballySending] = useState(false);

  // PR-5: State for files from CodebaseImporter, to be passed to PromptBuilder
  const [stagedCodeFiles, setStagedCodeFiles] = useState([]);

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
  } = useMessageManager(currentChatId, settings.apiKey, setIsAppGloballySending, setHasLastSendFailed);

  // PR-5: usePromptBuilder no longer manages 'pendingFiles' state for code files.
  // It will receive 'stagedCodeFiles' via PromptBuilder props.
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
    // pendingFiles, // Removed
    // setPendingFiles, // Removed
    currentProjectRootName,
    handleProjectRootChange, // This will be passed to CodebaseImporter to signal root changes
    userPromptText, // This will now be built using stagedCodeFiles
    resetPrompt,
  } = usePromptBuilder(stagedCodeFiles); // Pass stagedCodeFiles here

  const {
    scrollContainerRef,
    scrollToPrev,
    scrollToNext,
    scrollToBottom,
  } = useScrollNavigation();

  const handleSelectChat = useCallback(
    (newChatId) => {
      if (newChatId === currentChatId && !isSwitchingChat) return;
      if (isSwitchingChat && newChatId === currentChatId) return; // Already switching to this
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

  // PR-5: userPromptText from usePromptBuilder already incorporates stagedCodeFiles
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
      else return; // A newer call is already in progress or scheduled

      countTokensWithGemini(apiKey, model, currentItemsForApi)
        .then(count => {
          if (tokenCountVersionRef.current === currentVersion) setTotalApiTokenCount(count);
        })
        .catch(error => {
          console.warn("Total token counting error:", error);
          if (tokenCountVersionRef.current === currentVersion) setTotalApiTokenCount(0); // Reset on error
        })
        .finally(() => {
          if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(false);
        });
    },
    [] // No dependencies, it's a stable function
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
    // Estimate tokens for images not yet part of `messages` (i.e., pending in PromptBuilder)
    // Only if not currently sending, as they'd be included in `messages` optimistically then.
    if (!isAppGloballySending) {
      estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    }
    // Estimate tokens for images already in messages
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

  const navRailDisabled = useMemo(
    () => isLoadingSession || isSwitchingChat, // Nav rail is independent of message sending
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
      return { text: 'Processing…', disabled: true }; // Generic processing
    }

    if (!settings.apiKey) return { text: 'Set API Key', disabled: false }; // Not disabled, allows opening settings
    if (!currentChatId) return { text: 'Select Chat', disabled: false }; // Not disabled, allows selecting chat
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

  // The actual disabled state for the send button considers global busy states too
  const finalSendButtonDisabled = sendButtonDisplayInfo.disabled || globalBusy;


  useEffect(() => {
    // Auto-scroll to bottom logic
    if (messages.length > 0 && currentChatId && !isSwitchingChat) {
        const lastMessage = messages[messages.length - 1];
        // Scroll if last message is assistant's or if it's user's and not being edited
        if (lastMessage.role === 'assistant' || (lastMessage.role === 'user' && !editingId)) {
            const box = scrollContainerRef.current;
            // Only auto-scroll if user is already near the bottom
            if (box && (box.scrollHeight - box.scrollTop - box.clientHeight < 100)) {
                scrollToBottom('smooth');
            }
        }
    }
  }, [messages, editingId, scrollToBottom, scrollContainerRef, currentChatId, isSwitchingChat]);

  useEffect(() => {
    // Chat switch cleanup logic
    let cleanupRaf, scrollRaf, transitionEndRaf;

    if (currentChatId !== previousChatIdRef.current) {
      setHasLastSendFailed(false);
      // inFlightSendSnapshotMarkerRef.current = null; // If re-enabled, manage here
      cleanupRaf = requestAnimationFrame(() => {
        if (editingId) cancelEdit();
        // Reset prompt builder state on chat switch, except for images/PDFs which are global for now
        // resetPrompt(); // This might be too aggressive if user wants to carry over prompt text
      });
      if (currentChatId) {
        scrollRaf = requestAnimationFrame(() => scrollToBottom('auto'));
      }
      if (isSwitchingChat) {
        // Ensure isSwitchingChat is reset after animations/transitions could complete
        transitionEndRaf = requestAnimationFrame(() => setIsSwitchingChat(false));
      }
      previousChatIdRef.current = currentChatId;
    }
    return () => {
      if (cleanupRaf) cancelAnimationFrame(cleanupRaf);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (transitionEndRaf) cancelAnimationFrame(transitionEndRaf);
    };
  }, [currentChatId, isSwitchingChat, editingId, cancelEdit, scrollToBottom, setHasLastSendFailed, resetPrompt]);


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
    // PDFs and Images are handled by usePromptBuilder's pendingPDFs/pendingImages
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
          detail: 'high', // Or 'auto' or 'low'
          original_name: img.name,
        },
      })
    );

    // userPromptText already includes content from stagedCodeFiles (via usePromptBuilder)
    if (userPromptText?.trim()) {
      userMessageContentBlocks.push({ type: 'text', text: userPromptText });
    }

    if (userMessageContentBlocks.length === 0) {
      Toast('Cannot send an empty message.', 3000);
      return;
    }

    const onSendSuccess = () => {
      // inFlightSendSnapshotMarkerRef.current = null; // If re-enabled
    };

    sendMessage({
      userMessageContentBlocks,
      existingMessages: messages, // Pass current messages for context
      onSendSuccess: onSendSuccess,
    });

    resetPrompt(); // Clears form, pendingImages, pendingPDFs. CodebaseImporter state is separate.
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
    createChat(); // Default title/model handled by useChatSessionManager
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
            disabled={globalBusy} // Disable if any global operation is busy
          >
            {settings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>

          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>
            Konzuko&nbsp;AI {isAppGloballySending &&
              (isSendingMessage ? "(Sending...)" :
               isSavingEdit ? "(Saving...)" :
               isResendingMessage ? "(Resending...)" :
               "(Processing...)") // Fallback for other global sending states
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
                globalBusy || // Disable if any global operation is busy
                isLoadingMessageOps // Also disable if message ops are specifically busy
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
                value={GEMINI_MODEL_NAME} // Display the constant model name
                readOnly // Make it read-only as it's fixed
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
                disabled={navRailDisabled} // Use specific disabled state for nav rail
              >
                ↑
              </button>
              <button
                className="button icon-button"
                onClick={scrollToNext}
                title="Scroll Down"
                disabled={navRailDisabled} // Use specific disabled state for nav rail
              >
                ↓
              </button>
            </div>

            {currentChatId ? (
              <ChatArea
                key={currentChatId} // Ensure re-mount on chat switch for clean state
                messages={messages}
                isLoading={isLoadingMessages}
                forceLoading={isSwitchingChat} // Show loading placeholder during chat switch
                editingId={editingId}
                editText={editText}
                loadingSend={isAppGloballySending} // General sending state
                savingEdit={isAppGloballySending && isSavingEdit} // Specific saving edit state
                setEditText={setEditText}
                handleSaveEdit={saveEdit}
                handleCancelEdit={cancelEdit}
                handleStartEdit={startEdit}
                handleResendMessage={resendMessage}
                handleDeleteMessage={deleteMessage}
                actionsDisabled={chatAreaActionsDisabled} // Disable actions based on broader app state
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
              sendDisabled={finalSendButtonDisabled} // Use the most comprehensive disabled state
              sendButtonText={sendButtonDisplayInfo.text}
              handleSend={handleSend}
              showToast={Toast}
              imagePreviews={pendingImages}
              pdfPreviews={pendingPDFs}
              onRemoveImage={removePendingImage}
              onAddImage={addPendingImage} // For PR-4, these are passed through
              onAddPDF={addPendingPDF}     // For PR-4
              settings={settings}
              hasLastSendFailed={hasLastSendFailed}
              // PR-5: Pass stagedCodeFiles from App state, and onFilesChange to update it
              importedCodeFiles={stagedCodeFiles}
              onCodeFilesChange={setStagedCodeFiles} // This is what CodebaseImporter will call
              onProjectRootChange={handleProjectRootChange} // Pass down for CodebaseImporter
              promptBuilderRootName={currentProjectRootName} // Pass down for CodebaseImporter
              currentChatId={currentChatId} // Pass for context if needed by PromptBuilder/Importer
            />
          </div>
        </div>
      </div>
    </div>
  );
}
