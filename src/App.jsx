// file: src/App.jsx
/* src/App.jsx */
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
    MAX_ABSOLUTE_TOKEN_LIMIT,
    LOCALSTORAGE_PANE_WIDTH_KEY
} from './config.js';

import { useDisplaySettings } from './hooks.js';
import { useChatSessionManager } from './hooks/useChatSessionManager.js';
import { useMessageManager } from './hooks/useMessageManager.js';
import { usePromptBuilder } from './hooks/usePromptBuilder.js';
import { useScrollNavigation } from './hooks/useScrollNavigation.js';

import { useTokenizableContent } from './hooks/useTokenizableContent.js';
import { countTokensWithGemini } from './lib/tokenWorkerClient.js';
import { supabase } from './lib/supabase.js';

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
};

const getInitialPaneWidth = () => {
  try {
    const storedWidth = localStorage.getItem(LOCALSTORAGE_PANE_WIDTH_KEY);
    if (storedWidth) {
      const percent = parseFloat(storedWidth);
      if (percent >= 20 && percent <= 80) {
        return `${percent}%`;
      }
    }
  } catch (e) {
    console.warn("Could not read pane width from localStorage", e);
  }
  return window.innerWidth <= 1600 ? '60%' : '50%';
};

export default function App() {
  const [displaySettings, setDisplaySettings] = useDisplaySettings();
  const [apiKey, setApiKey] = useState('');
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const handleToggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  const [leftPaneWidth, setLeftPaneWidth] = useState(getInitialPaneWidth);
  const [isResizing, setIsResizing] = useState(false);
  const appContainerRef = useRef(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const settings = useMemo(() => ({
    ...displaySettings,
    apiKey,
  }), [displaySettings, apiKey]);

  const previousChatIdRef = useRef(null);
  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const [hasLastSendFailed, setHasLastSendFailed] = useState(false);
  
  const [stagedCodeFiles, setStagedCodeFiles] = useState([]);

  const {
    currentChatId,
    setCurrentChatId: originalSetCurrentChatId,
    createChat,
    deleteChat,
    updateChatTitle,
    isSessionBusy,
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
    isForking,
    isResendingMessage,
  } = useMessageManager(currentChatId, setHasLastSendFailed);

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
    currentProjectRootName,
    handleProjectRootChange,
    formText,
    fileText,
    userPromptText,
    resetPrompt,
  } = usePromptBuilder(stagedCodeFiles);

  const {
    scrollContainerRef,
    scrollToPrev,
    scrollToNext,
    scrollToBottom,
  } = useScrollNavigation();

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = appContainerRef.current.querySelector('.chat-container').offsetWidth;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      requestAnimationFrame(() => {
        const deltaX = e.clientX - startXRef.current;
        const containerWidth = appContainerRef.current.offsetWidth;
        let newWidth = startWidthRef.current + deltaX;

        const minWidth = containerWidth * 0.20;
        const maxWidth = containerWidth * 0.80;
        newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

        const newWidthPercent = (newWidth / containerWidth) * 100;
        setLeftPaneWidth(`${newWidthPercent}%`);
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem(LOCALSTORAGE_PANE_WIDTH_KEY, parseFloat(leftPaneWidth));
      } catch (e) {
        console.warn("Could not save pane width to localStorage", e);
      }
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, leftPaneWidth]);

  useEffect(() => {
    const fetchApiKey = async () => {
      setIsApiKeyLoading(true);
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          setIsApiKeyLoading(false);
          return;
        }

        const { data, error: invokeError } = await supabase.functions.invoke('manage-api-key', {
          method: 'GET',
        });

        if (invokeError) throw invokeError;
        
        if (data && typeof data.apiKey === 'string') {
          setApiKey(data.apiKey);
        } else if (data && data.error) {
            throw new Error(data.error);
        }
      } catch (err) {
        console.error('Failed to fetch API key:', err);
        Toast(`Error fetching API key: ${err.message}`, 5000);
      } finally {
        setIsApiKeyLoading(false);
      }
    };
    fetchApiKey();
  }, []);

  const handleApiKeyChangeAndSave = async (newApiKey) => {
    const oldApiKey = apiKey;
    setApiKey(newApiKey);

    try {
      const { error: invokeError, data:responseData } = await supabase.functions.invoke('manage-api-key', {
        method: 'POST',
        body: { apiKey: newApiKey },
      });

      if (invokeError) throw invokeError;
      if (responseData && responseData.error) throw new Error(responseData.error);

      Toast('API key saved!', 3000);
    } catch (err) {
      console.error('Failed to save API key:', err);
      setApiKey(oldApiKey);
      Toast(`Error saving API key: ${err.message}`, 5000);
    }
  };

  const isAwaitingApiResponse = isSendingMessage || isForking || isResendingMessage;

  const handleSelectChat = useCallback(
    (newChatId) => {
      if (newChatId === currentChatId && !isSwitchingChat) return;
      if (isSwitchingChat && newChatId === currentChatId) return;
      if (isLoadingMessageOps || isSessionBusy) {
        Toast("An operation is in progress. Please wait.", 3000);
        return;
      }
      setIsSwitchingChat(true);
      originalSetCurrentChatId(newChatId);
    },
    [currentChatId, originalSetCurrentChatId, isSwitchingChat, isLoadingMessageOps, isSessionBusy]
  );

  const [totalApiTokenCount, setTotalApiTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  const itemsForApiCount = useTokenizableContent(
    messages,
    formText,
    fileText,
    pendingPDFs,
    isAwaitingApiResponse
  );

  const callWorkerForTotalTokenCount = useCallback(
    (currentItemsForApi, currentApiKey, model) => {
      const currentVersion = ++tokenCountVersionRef.current;
      if (!currentApiKey || String(currentApiKey).trim() === "" || !currentItemsForApi || currentItemsForApi.length === 0) {
        if (tokenCountVersionRef.current === currentVersion) {
          setTotalApiTokenCount(0);
          setIsCountingApiTokens(false);
        }
        return;
      }
      if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(true);
      else return;

      countTokensWithGemini(currentApiKey, model, currentItemsForApi)
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
      debouncedApiCallRef.current = debounce(callWorkerForTotalTokenCount, 500);
    }
    const modelToUse = settings.model || GEMINI_MODEL_NAME;
    debouncedApiCallRef.current(itemsForApiCount, settings.apiKey, modelToUse);
  }, [itemsForApiCount, settings.apiKey, settings.model, callWorkerForTotalTokenCount]);


  const currentTotalPromptTokens = useMemo(() => {
    let estimatedImageTokens = 0;
    if (!isAwaitingApiResponse) {
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
  }, [totalApiTokenCount, pendingImages, messages, isAwaitingApiResponse]);


  const isSoftMemoryLimitReached = currentTotalPromptTokens >= USER_FACING_TOKEN_LIMIT;
  const isHardTokenLimitReached = currentTotalPromptTokens >= MAX_ABSOLUTE_TOKEN_LIMIT;

  const chatListDisabled = useMemo(
    () => isCreatingChat || isSwitchingChat || isLoadingMessageOps || isSessionBusy,
    [isCreatingChat, isSwitchingChat, isLoadingMessageOps, isSessionBusy]
  );

  const globalBusy = useMemo(
    () => isLoadingMessageOps || isSessionBusy || isSwitchingChat || isApiKeyLoading,
    [isLoadingMessageOps, isSessionBusy, isSwitchingChat, isApiKeyLoading]
  );

  const navRailDisabled = useMemo(
    () => globalBusy,
    [globalBusy]
  );

  const chatAreaActionsDisabled = useMemo(
    () => globalBusy,
    [globalBusy]
  );

  const sendButtonDisplayInfo = useMemo(() => {
    if (globalBusy) {
      if (isResendingMessage) return { text: 'Resending…', disabled: true };
      if (isSendingMessage) return { text: 'Sending…', disabled: true };
      if (isForking) return { text: 'Forking…', disabled: true };
      if (isCreatingChat) return { text: 'Creating Task…', disabled: true };
      return { text: 'Processing…', disabled: true };
    }
    if (isApiKeyLoading) return { text: 'Loading Key...', disabled: true };
    if (!settings.apiKey) return { text: 'Set API Key', disabled: false };
    if (!currentChatId) return { text: 'Select Task', disabled: false };
    if (isHardTokenLimitReached) return { text: 'Memory Limit Exceeded', disabled: true };
    return { text: 'Send', disabled: false };
  }, [
    globalBusy, isResendingMessage, isSendingMessage, isForking, isCreatingChat,
    settings.apiKey, currentChatId, isHardTokenLimitReached, isApiKeyLoading,
  ]);

  useEffect(() => {
    if (messages.length > 0 && currentChatId && !isSwitchingChat) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'assistant' || (lastMessage.role === 'user' && !editingId)) {
            const box = scrollContainerRef.current;
            if (box && (box.scrollHeight - box.scrollTop - box.clientHeight < 100)) {
                scrollToBottom('smooth');
            }
        }
    }
  }, [messages, editingId, scrollToBottom, scrollContainerRef, currentChatId, isSwitchingChat]);

  useEffect(() => {
    let cleanupRaf, scrollRaf, transitionEndRaf;
    if (currentChatId !== previousChatIdRef.current) {
      setHasLastSendFailed(false);
      cleanupRaf = requestAnimationFrame(() => {
        if (editingId) cancelEdit();
        resetPrompt();
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
  }, [currentChatId, isSwitchingChat, editingId, cancelEdit, scrollToBottom, setHasLastSendFailed, resetPrompt]);


  function handleSend() {
    if (globalBusy) { Toast("An operation is already in progress.", 3000); return; }
    if (isHardTokenLimitReached) { Toast(`Memory limit exceeded (max ${MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()}).`, 8000); return; }
    if (!currentChatId) { Toast('Please select or create a task first.', 3000); return; }
    
    if (!settings.apiKey || String(settings.apiKey).trim() === '') {
      if (isApiKeyLoading) {
        Toast('API Key is still loading. Please wait.', 3000);
        return;
      }
      Toast('Gemini API Key missing. Please set it in settings.', 5000);
      setDisplaySettings((s) => ({ ...s, showSettings: true }));
      return;
    }

    const userMessageContentBlocks = [];
    pendingPDFs.forEach((p) =>
      userMessageContentBlocks.push({
        type: 'file',
        file: { file_id: p.fileId, original_name: p.name, mime_type: p.mimeType, },
      })
    );
    pendingImages.forEach((img) =>
      userMessageContentBlocks.push({
        type: 'image_url',
        image_url: { url: img.url, detail: 'high', original_name: img.name, },
      })
    );
    if (userPromptText?.trim()) {
      userMessageContentBlocks.push({ type: 'text', text: userPromptText });
    }
    if (userMessageContentBlocks.length === 0) { Toast('Cannot send an empty message.', 3000); return; }

    sendMessage({ userMessageContentBlocks, existingMessages: messages, apiKey: settings.apiKey });
    resetPrompt();
  }

  const handleCopyAll = () => {
    const txt = messages.map((m) => { const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }]; return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); }).join('\n\n');
    navigator.clipboard.writeText(txt).then(() => Toast('Copied all text!', 2000)).catch(() => Toast('Copy failed.', 4000));
  };
  
  const handleUpdateChatTitleTrigger = useCallback(async (id, title) => {
    if (globalBusy) {
      Toast("Cannot update title while an operation is in progress.", 3000);
      return Promise.reject(new Error("Operation in progress"));
    }
    if (!id) {
      console.error('handleUpdateChatTitleTrigger called with undefined id');
      Toast('Error: Could not update title.', 4000);
      return Promise.reject(new Error("Invalid ID"));
    }
    return updateChatTitle({ id, title });
  }, [updateChatTitle, globalBusy]);

  const handleNewChatTrigger = useCallback(() => { if (globalBusy) { Toast("Cannot create new task while an operation is in progress.", 3000); return; } createChat(); }, [createChat, globalBusy]);
  const handleDeleteChatTrigger = useCallback((chatId) => { if (globalBusy) { Toast("Cannot delete task while an operation is in progress.", 3000); return; } deleteChat(chatId); }, [deleteChat, globalBusy]);

  return (
    <div className="app-container" ref={appContainerRef}>
      <ChatList
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChatTrigger={handleNewChatTrigger}
        onDeleteChatTrigger={handleDeleteChatTrigger}
        onUpdateChatTitleTrigger={handleUpdateChatTitleTrigger}
        appDisabled={chatListDisabled}
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
      />
      <div className="main-content">
        <div className="top-bar">
          {collapsed && (
            <button
              className="button icon-button sidebar-expand-toggle"
              onClick={handleToggleCollapse}
              title="Expand Sidebar"
            >
              {'»'}
            </button>
          )}
          <div 
            className={`top-bar-loading-indicator ${isAwaitingApiResponse ? 'active' : ''}`} 
          />
          <button className="button" onClick={() => setDisplaySettings((s) => ({ ...s, showSettings: !s.showSettings }))} disabled={globalBusy} >
            {displaySettings.showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>
            Konzuko&nbsp;AI {isAwaitingApiResponse && "(Processing...)"}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5em', alignItems: 'center', }} >
            {isAwaitingApiResponse && (
              <div style={{
                  color: '#ffffff',
                  backgroundColor: '#000000',
                  padding: 'var(--space-xs) var(--space-sm)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  fontWeight: 'bold',
                  fontSize: '0.85em',
                  marginRight: 'var(--space-md)'
              }}>
                  Press F5 to Cancel
              </div>
            )}
            {isSoftMemoryLimitReached && (
              <div style={{ color: isHardTokenLimitReached ? 'var(--error)' : 'var(--warning)', fontWeight: 'bold', padding: 'var(--space-xs) var(--space-sm)', border: `1px solid ${ isHardTokenLimitReached ? 'var(--error)' : 'var(--warning)' }`, borderRadius: 'var(--radius)', marginRight: 'var(--space-sm)', }} >
                {isHardTokenLimitReached ? 'MAX\u00A0MEMORY\u00A0REACHED' : 'MEMORY\u00A0AT\u00A0LIMIT'}
              </div>
            )}
            <div className="token-count-display" style={ isHardTokenLimitReached ? { color: 'var(--error)', fontWeight: 'bold', border: '1px solid var(--error)', } : {} } >
              <strong style={{marginRight: '0.5em'}}>MEMORY</strong>
              {currentTotalPromptTokens.toLocaleString()}
              <span className={isCountingApiTokens ? 'token-count-loader' : 'token-count-separator'}>
                {isCountingApiTokens ? '' : '/'}
              </span>
              {USER_FACING_TOKEN_LIMIT.toLocaleString()}
              {isHardTokenLimitReached && ( <span style={{ marginLeft: 4 }}> {' '} (Max&nbsp; {MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()}) </span> )}
            </div>
            <button className="button" onClick={handleCopyAll} disabled={ !messages || messages.length === 0 || globalBusy } >
              Copy All Text
            </button>
          </div>
        </div>

        {displaySettings.showSettings && (
          <div className="settings-panel">
            <div className="form-group">
              <label htmlFor="apiKeyInputApp"> Gemini API Key (Google AI Studio): </label>
              <input 
                id="apiKeyInputApp" 
                className="form-input" 
                type="password" 
                value={apiKey}
                onInput={(e) => handleApiKeyChangeAndSave(e.target.value)}
                placeholder={isApiKeyLoading ? "Loading API Key..." : "Enter your Gemini API Key"}
                disabled={isApiKeyLoading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="modelInputApp">Model:</label>
              <input id="modelInputApp" className="form-input" value={settings.model} readOnly />
            </div>
          </div>
        )}

        <div className="content-container">
          <div className="chat-container" style={{ flexBasis: leftPaneWidth }}>
            <div className="chat-messages-scroll-area" ref={scrollContainerRef}>
              {currentChatId ? (
                <ChatArea
                  key={currentChatId} messages={messages} isLoading={isLoadingMessages} forceLoading={isSwitchingChat}
                  editingId={editingId} editText={editText} loadingSend={isAwaitingApiResponse} savingEdit={isForking}
                  setEditText={setEditText} handleSaveEdit={() => saveEdit(settings.apiKey)} handleCancelEdit={cancelEdit} handleStartEdit={startEdit}
                  handleResendMessage={(messageId) => resendMessage(messageId, settings.apiKey)} handleDeleteMessage={deleteMessage} actionsDisabled={chatAreaActionsDisabled}
                />
              ) : ( <div className="chat-empty-placeholder"> Select or create a task to begin. </div> )}
            </div>
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up" disabled={navRailDisabled} > ↑ </button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down" disabled={navRailDisabled} > ↓ </button>
            </div>
          </div>
          <div className="resizable-handle" onMouseDown={handleMouseDown} />
          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode} setMode={setMode} form={form} setForm={setForm}
              sendDisabled={sendButtonDisplayInfo.disabled} sendButtonText={sendButtonDisplayInfo.text}
              handleSend={handleSend} showToast={Toast}
              imagePreviews={pendingImages} pdfPreviews={pendingPDFs}
              onRemoveImage={removePendingImage} onAddImage={addPendingImage} onAddPDF={addPendingPDF}
              settings={settings}
              hasLastSendFailed={hasLastSendFailed}
              importedCodeFiles={stagedCodeFiles}
              onCodeFilesChange={setStagedCodeFiles}
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
