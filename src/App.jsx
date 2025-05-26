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
    addPendingPDF, // Correctly destructured function
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

      setIsSwitchingChat(true);
      originalSetCurrentChatId(newChatId);
    },
    [currentChatId, originalSetCurrentChatId, isSwitchingChat]
  );

  /* ───────────────────────────────── TOKEN COUNTING ───────────────────────── */
  const [totalApiTokenCount, setTotalApiTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const itemsForApiCount = useTokenizableContent(
    messages,
    userPromptText,
    pendingPDFs,
    isSendingMessage
  );

  const callWorkerForTotalTokenCount = useCallback(
    (currentItemsForApi, apiKey, model) => {
      const currentVersion = ++tokenCountVersionRef.current;

      if (
        !apiKey ||
        String(apiKey).trim() === '' ||
        !currentItemsForApi ||
        currentItemsForApi.length === 0
      ) {
        if (tokenCountVersionRef.current === currentVersion) {
          setTotalApiTokenCount(0);
          setIsCountingApiTokens(false);
        }
        return;
      }

      if (tokenCountVersionRef.current === currentVersion)
        setIsCountingApiTokens(true);
      else return;

      countTokensWithGemini(apiKey, model, currentItemsForApi)
        .then((count) => {
          if (tokenCountVersionRef.current === currentVersion)
            setTotalApiTokenCount(count);
        })
        .catch((err) => {
          console.warn('Total token counting error:', err);
          if (tokenCountVersionRef.current === currentVersion)
            setTotalApiTokenCount(0);
        })
        .finally(() => {
          if (tokenCountVersionRef.current === currentVersion)
            setIsCountingApiTokens(false);
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
  }, [
    itemsForApiCount,
    settings.apiKey,
    settings.model,
    callWorkerForTotalTokenCount,
  ]);

  const currentTotalPromptTokens = useMemo(() => {
    let estimatedImageTokens = 0;
    if (!isSendingMessage) {
      estimatedImageTokens += pendingImages.length * IMAGE_TOKEN_ESTIMATE;
    }
    (messages || []).forEach((m) => {
      const contentBlocks = Array.isArray(m.content)
        ? m.content
        : [{ type: 'text', text: String(m.content ?? '') }];
      contentBlocks.forEach((b) => {
        if (b.type === 'image_url' && b.image_url?.url) {
          estimatedImageTokens += IMAGE_TOKEN_ESTIMATE;
        }
      });
    });
    return totalApiTokenCount + estimatedImageTokens;
  }, [totalApiTokenCount, pendingImages, messages, isSendingMessage]);

  const isSoftMemoryLimitReached =
    currentTotalPromptTokens >= USER_FACING_TOKEN_LIMIT;
  const isHardTokenLimitReached =
    currentTotalPromptTokens >= MAX_ABSOLUTE_TOKEN_LIMIT;

  /* ───────────────────────────── DISABLED / BUSY FLAGS ────────────────────── */
  const chatListDisabled = useMemo(
    () => isCreatingChat || isSwitchingChat,
    [isCreatingChat, isSwitchingChat]
  );

  const globalBusy = useMemo(
    () => isLoadingSession || isSwitchingChat,
    [isLoadingSession, isSwitchingChat]
  );

  const chatAreaActionsDisabled = useMemo(
    () => isLoadingMessageOps || isLoadingSession || isSwitchingChat,
    [isLoadingMessageOps, isLoadingSession, isSwitchingChat]
  );

  const sendButtonDisabled = useMemo(
    () =>
      isSendingMessage ||
      isSavingEdit ||
      isResendingMessage ||
      isHardTokenLimitReached,
    [isSendingMessage, isSavingEdit, isResendingMessage, isHardTokenLimitReached]
  );

  /* ───────────────────────────── EFFECTS – SCROLLING ──────────────────────── */
  useEffect(() => {
    if (messages.length > 0 && currentChatId && !isSwitchingChat) {
      const last = messages[messages.length - 1];
      if (
        last.role === 'assistant' ||
        (last.role === 'user' && !editingId)
      ) {
        const box = scrollContainerRef.current;
        if (
          !box ||
          box.scrollHeight - box.scrollTop - box.clientHeight <= 100
        ) {
          scrollToBottom('smooth');
        }
      }
    }
  }, [
    messages,
    editingId,
    scrollToBottom,
    scrollContainerRef,
    currentChatId,
    isSwitchingChat,
  ]);

  /* ───────────────────────── EFFECTS – CHAT‐SWITCH CLEANUP ────────────────── */
  useEffect(() => {
    let cleanupRaf, scrollRaf, transitionEndRaf;

    if (currentChatId !== previousChatIdRef.current) {
      sentPromptStateRef.current = null;

      cleanupRaf = requestAnimationFrame(() => {
        if (editingId) cancelEdit();
        resetPrompt();
      });
      if (currentChatId) {
        scrollRaf = requestAnimationFrame(() => scrollToBottom('auto'));
      }
      if (isSwitchingChat) {
        transitionEndRaf = requestAnimationFrame(() =>
          setIsSwitchingChat(false)
        );
      }
      previousChatIdRef.current = currentChatId;
    }

    return () => {
      if (cleanupRaf) cancelAnimationFrame(cleanupRaf);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (transitionEndRaf) cancelAnimationFrame(transitionEndRaf);
    };
  }, [
    currentChatId,
    isSwitchingChat,
    editingId,
    resetPrompt,
    cancelEdit,
    scrollToBottom,
  ]);

  /* ─────────────────────────────── SEND HANDLER ───────────────────────────── */
  function handleSend() {
    if (isHardTokenLimitReached) {
      Toast(
        `Prompt too large (max ${MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()} tokens). Please reduce content.`,
        8000
      );
      return;
    }
    if (globalBusy) {
      Toast('Application is busy. Please wait.', 3000);
      return;
    }
    if (isSendingMessage || isSavingEdit || isResendingMessage) {
      if (isSavingEdit) Toast('An edit is in progress.', 3000);
      else if (isResendingMessage) Toast('A resend is in progress.', 3000);
      else if (isSendingMessage) Toast('Already sending.', 3000);
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

    sentPromptStateRef.current = {
      userPromptText,
      pendingImages: pendingImages.map(({ url, name }) => ({ url, name })),
      pendingPDFs: pendingPDFs.map(({ fileId, name }) => ({ fileId, name })),
    };

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
      const sentState = sentPromptStateRef.current;
      if (!sentState) return;

      const imgsEqual =
        pendingImages.length === sentState.pendingImages.length &&
        pendingImages.every(
          (img, i) =>
            sentState.pendingImages[i] &&
            img.url === sentState.pendingImages[i].url &&
            img.name === sentState.pendingImages[i].name
        );
      const pdfsEqual =
        pendingPDFs.length === sentState.pendingPDFs.length &&
        pendingPDFs.every(
          (pdf, i) =>
            sentState.pendingPDFs[i] &&
            pdf.fileId === sentState.pendingPDFs[i].fileId &&
            pdf.name === sentState.pendingPDFs[i].name
        );

      if (
        userPromptText === sentState.userPromptText &&
        imgsEqual &&
        pdfsEqual
      ) {
        resetPrompt();
      }
      sentPromptStateRef.current = null;
    };

    sendMessage({
      userMessageContentBlocks,
      existingMessages: messages,
      onSendSuccess,
    });
  }

  /* ───────────────────── COPY‐ALL FOR CONVENIENCE ────────────────────────── */
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
      if (!id) {
        console.error('handleUpdateChatTitleTrigger called with undefined id');
        Toast('Error: Could not update title.', 4000);
        return;
      }
      updateChatTitle({ id, title });
    },
    [updateChatTitle]
  );

  /* ───────────────────────────────── RENDER ───────────────────────────────── */
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
        {/* ─────────── TOP BAR ─────────── */}
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
            Konzuko&nbsp;AI
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
                  ? 'MAX\u00A0TOKENS\u00A0REACHED' // Using non-breaking space
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

        {/* ─────────── SETTINGS PANEL ─────────── */}
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

        {/* ─────────── MAIN CONTENT ─────────── */}
        <div className="content-container">
          {/* CHAT AREA (messages) */}
          <div className="chat-container" ref={scrollContainerRef}>
            <div className="chat-nav-rail">
              <button
                className="button icon-button"
                onClick={scrollToPrev}
                title="Scroll Up"
                disabled={globalBusy}
              >
                ↑
              </button>
              <button
                className="button icon-button"
                onClick={scrollToNext}
                title="Scroll Down"
                disabled={globalBusy}
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
              <div className="chat-empty-placeholder">
                Select or create a chat to begin.
              </div>
            )}
          </div>

          {/* PROMPT BUILDER */}
          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode}
              setMode={setMode}
              form={form}
              setForm={setForm}
              sendDisabled={sendButtonDisabled}
              handleSend={handleSend}
              showToast={Toast}
              imagePreviews={pendingImages}
              pdfPreviews={pendingPDFs}
              onRemoveImage={removePendingImage}
              onAddImage={addPendingImage}
              onAddPDF={addPendingPDF} // Prop name matches function from usePromptBuilder
              settings={settings}
              pendingFiles={pendingFiles}
              onFilesChange={setPendingFiles}
              onProjectRootChange={handleProjectRootChange}
              promptBuilderRootName={currentProjectRootName}
              currentChatId={currentChatId} // Pass currentChatId to PromptBuilder
            />
          </div>
        </div>
      </div>
    </div>
  );
}
