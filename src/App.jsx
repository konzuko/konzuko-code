// file: src/App.jsx
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback
} from 'preact/hooks';
import { useQueryClient } from '@tanstack/react-query'; // Import useQueryClient

import ChatProvider, { useChat } from './contexts/ChatContext.jsx';
import ChatList from './ChatList.jsx';
import PromptBuilder from './PromptBuilder.jsx';
import ChatArea from './components/ChatArea.jsx';
import Toast from './components/Toast.jsx';
import { supabase } from './lib/supabase.js';
import { debounce } from './lib/utils.js';

import {
    IMAGE_TOKEN_ESTIMATE,
    USER_FACING_TOKEN_LIMIT,
    MAX_ABSOLUTE_TOKEN_LIMIT,
    LOCALSTORAGE_PANE_WIDTH_KEY,
    TOKEN_COUNT_DEBOUNCE_MS
} from './config.js';

import { useSettings } from './contexts/SettingsContext.jsx';
import { usePromptBuilder } from './hooks/usePromptBuilder.js';
import { useScrollNavigation } from './hooks/useScrollNavigation.js';
import { useTokenizableContent } from './hooks/useTokenizableContent.js';
import { countTokensWithGemini, initTokenWorker } from './lib/tokenWorkerClient.js';

// FIX: Add a component to handle post-checkout redirects and proactively refetch subscription status.
function CheckoutStatusHandler() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has('checkout')) {
      const status = query.get('checkout');
      if (status === 'success') {
        Toast('Payment successful! Welcome to Konzuko Pro.', 5000);
        // Proactively refetch the subscription status to update the UI faster than the webhook.
        queryClient.invalidateQueries({ queryKey: ['subscription'] });
      } else if (status === 'cancel') {
        Toast('Your order was cancelled. You can try again anytime.', 5000);
      }
      // Clean the URL to prevent the toast from showing on refresh.
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [queryClient]);

  return null; // This component renders nothing.
}


function MainLayout() {
  const { 
    collapsed, 
    handleToggleCollapse, 
    leftPaneWidth, 
    setLeftPaneWidth,
    displaySettings,
    setDisplaySettings,
    apiKey,
    isApiKeyLoading,
    handleApiKeyChangeAndSave,
    handleManageSubscription,
    model,
  } = useSettings();

  const {
    currentChatId,
    isSessionBusy,
    isCreatingChat,
    messages,
    isLoadingMessages,
    editingId,
    cancelEdit,
    sendMessage,
    isSendingMessage,
    isForking,
    isResendingMessage,
    hasLastSendFailed,
    isBusy,
  } = useChat();
  
  const [isResizing, setIsResizing] = useState(false);
  const appContainerRef = useRef(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const previousChatIdRef = useRef(null);
  
  const [stagedCodeFiles, setStagedCodeFiles] = useState([]);

  const clearCodebaseImporterRef = useRef(null);

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
    userPromptText,
    resetPrompt,
  } = usePromptBuilder(stagedCodeFiles);

  const {
    scrollContainerRef,
    scrollToPrev,
    scrollToNext,
    scrollToBottom,
  } = useScrollNavigation();

  useEffect(() => {
    appContainerRef.current?.style.setProperty('--left-pane-width', leftPaneWidth);
  }, [leftPaneWidth]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    const chatContainer = appContainerRef.current?.querySelector('.chat-container');
    if (chatContainer) {
      startWidthRef.current = chatContainer.offsetWidth;
      setIsResizing(true);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!appContainerRef.current) return;
      const deltaX = e.clientX - startXRef.current;
      const containerWidth = appContainerRef.current.offsetWidth;
      let newWidth = startWidthRef.current + deltaX;

      const minWidth = containerWidth * 0.20;
      const maxWidth = containerWidth * 0.80;
      newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
      
      const newWidthPercent = (newWidth / containerWidth) * 100;
      appContainerRef.current.style.setProperty('--left-pane-width', `${newWidthPercent}%`);
    };

    const handleMouseUp = () => {
      if (!appContainerRef.current) return;
      setIsResizing(false);
      const finalWidth = appContainerRef.current.style.getPropertyValue('--left-pane-width');
      setLeftPaneWidth(finalWidth);
      try {
        localStorage.setItem(LOCALSTORAGE_PANE_WIDTH_KEY, parseFloat(finalWidth));
      } catch (e) {
        console.warn("Could not save pane width to localStorage", e);
      }
    };

    if (isResizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setLeftPaneWidth]);

  const isAwaitingApiResponse = isSendingMessage || isForking || isResendingMessage;

  const itemsForApiCount = useTokenizableContent(
    messages,
    userPromptText,
    null,
    pendingPDFs,
    isAwaitingApiResponse
  );

  const [totalApiTokenCount, setTotalApiTokenCount] = useState(0);
  const [isCountingApiTokens, setIsCountingApiTokens] = useState(false);
  const tokenCountVersionRef = useRef(0);
  const debouncedApiCallRef = useRef(null);

  useEffect(() => {
    if (apiKey && !isApiKeyLoading) {
      initTokenWorker(apiKey);
    }
  }, [apiKey, isApiKeyLoading]);

  const callWorkerForTotalTokenCount = useCallback(
    (currentItemsForApi, modelToUse) => {
      const currentVersion = ++tokenCountVersionRef.current;
      if (!currentItemsForApi || currentItemsForApi.length === 0) {
        if (tokenCountVersionRef.current === currentVersion) {
          setTotalApiTokenCount(0);
          setIsCountingApiTokens(false);
        }
        return;
      }
      if (tokenCountVersionRef.current === currentVersion) setIsCountingApiTokens(true);
      else return;

      countTokensWithGemini(modelToUse, currentItemsForApi)
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
      debouncedApiCallRef.current = debounce(callWorkerForTotalTokenCount, TOKEN_COUNT_DEBOUNCE_MS);
    }
    if (apiKey) {
      debouncedApiCallRef.current(itemsForApiCount, model);
    } else {
      setTotalApiTokenCount(0);
      setIsCountingApiTokens(false);
    }
  }, [itemsForApiCount, apiKey, model, callWorkerForTotalTokenCount]);


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
        if (block.type === 'image_url' && block.image_url && (block.image_url.url || block.image_url.path)) {
          estimatedImageTokens += IMAGE_TOKEN_ESTIMATE;
        }
      });
    });
    return totalApiTokenCount + estimatedImageTokens;
  }, [totalApiTokenCount, pendingImages, messages, isAwaitingApiResponse]);


  const isSoftMemoryLimitReached = currentTotalPromptTokens >= USER_FACING_TOKEN_LIMIT;
  const isHardTokenLimitReached = currentTotalPromptTokens >= MAX_ABSOLUTE_TOKEN_LIMIT;

  const sendButtonDisplayInfo = useMemo(() => {
    if (isBusy) {
      if (isResendingMessage) return { text: 'Resending…', disabled: true };
      if (isSendingMessage) return { text: 'Sending…', disabled: true };
      if (isForking) return { text: 'Forking…', disabled: true };
      if (isCreatingChat) return { text: 'Creating Task…', disabled: true };
      if (isApiKeyLoading) return { text: 'Loading Key...', disabled: true };
      return { text: 'Processing…', disabled: true };
    }
    if (!apiKey) return { text: 'Set API Key', disabled: false };
    if (!currentChatId) return { text: 'Select Task', disabled: false };
    if (isHardTokenLimitReached) return { text: 'Memory Limit Exceeded', disabled: true };
    return { text: 'Send', disabled: false };
  }, [
    isBusy, isResendingMessage, isSendingMessage, isForking, isCreatingChat,
    apiKey, currentChatId, isHardTokenLimitReached, isApiKeyLoading,
  ]);

  useEffect(() => {
    if (messages.length > 0 && currentChatId) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role === 'assistant' || (lastMessage.role === 'user' && !editingId)) {
            const box = scrollContainerRef.current;
            if (box && (box.scrollHeight - box.scrollTop - box.clientHeight < 100)) {
                scrollToBottom('smooth');
            }
        }
    }
  }, [messages, editingId, scrollToBottom, scrollContainerRef, currentChatId]);

  useEffect(() => {
    if (currentChatId !== previousChatIdRef.current) {
      const cleanupRaf = requestAnimationFrame(() => {
        if (editingId) cancelEdit();
      });
      const scrollRaf = requestAnimationFrame(() => {
        if (currentChatId) scrollToBottom('auto');
      });
      
      previousChatIdRef.current = currentChatId;

      return () => {
        cancelAnimationFrame(cleanupRaf);
        cancelAnimationFrame(scrollRaf);
      };
    }
  }, [currentChatId, editingId, cancelEdit, scrollToBottom]);


  async function handleSend() {
    if (isBusy) { Toast("An operation is already in progress.", 3000); return; }
    if (isHardTokenLimitReached) { Toast(`Memory limit exceeded (max ${MAX_ABSOLUTE_TOKEN_LIMIT.toLocaleString()}).`, 8000); return; }
    if (!currentChatId) { Toast('Please select or create a task first.', 3000); return; }
    
    if (!apiKey || String(apiKey).trim() === '') {
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
    
    if (pendingImages.length > 0) {
      pendingImages.forEach(img => {
        userMessageContentBlocks.push({
          type: 'image_url',
          image_url: { detail: 'high', original_name: img.name, path: img.path },
        });
      });
    }

    if (userPromptText?.trim()) {
      userMessageContentBlocks.push({ type: 'text', text: userPromptText });
    }
    if (userMessageContentBlocks.length === 0) { Toast('Cannot send an empty message.', 3000); return; }

    sendMessage({ userMessageContentBlocks, existingMessages: messages, apiKey: apiKey });
    
    resetPrompt();
    if (clearCodebaseImporterRef.current) {
        clearCodebaseImporterRef.current();
    }
  }

  const handleCopyAll = () => {
    const txt = messages.map((m) => { const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content ?? '') }]; return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'); }).join('\n\n');
    navigator.clipboard.writeText(txt).then(() => Toast('Copied all text!', 2000)).catch(() => Toast('Copy failed.', 4000));
  };

  return (
    <div className="app-container" ref={appContainerRef}>
      <CheckoutStatusHandler />
      <ChatList appDisabled={isBusy} />
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
          <button className="button" onClick={() => setDisplaySettings((s) => ({ ...s, showSettings: !s.showSettings }))} disabled={isBusy} >
            {displaySettings.showSettings ? 'Close Settings' : 'Settings'}
          </button>
          <span style={{ margin: '0 1em', fontWeight: 'bold' }}>
            KonzukoCode {isAwaitingApiResponse && "Processing..."}
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
            <button className="button" onClick={handleCopyAll} disabled={!messages || messages.length === 0} >
              Copy All Text
            </button>
          </div>
        </div>

        {displaySettings.showSettings && (
          <div className="settings-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '50%' }}>
                <div className="form-group">
                  <label htmlFor="apiKeyInputApp" style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>
                    Gemini API Key (Google AI Studio):
                  </label>
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
                  <input id="modelInputApp" className="form-input" value={model} readOnly />
                </div>
                 <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-accent"
                >
                  Get your Key
                </a>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)' }}>Account</h3>
                <button className="button" onClick={handleManageSubscription}>Manage Subscription</button>
                <button className="button" style={{ marginLeft: 'var(--space-sm)' }} onClick={() => supabase.auth.signOut()}>Sign Out</button>
              </div>
            </div>
          </div>
        )}

        <div className="content-container">
          <div className="chat-container" style={{ flexBasis: 'var(--left-pane-width, 50%)' }}>
            <div className="chat-messages-scroll-area" ref={scrollContainerRef}>
              {currentChatId ? (
                <ChatArea
                  key={currentChatId}
                  actionsDisabled={isBusy}
                  scrollParentRef={scrollContainerRef}
                />
              ) : ( <div className="chat-empty-placeholder"> Select or create a task to begin. </div> )}
            </div>
            <div className="chat-nav-rail">
              <button className="button icon-button" onClick={scrollToPrev} title="Scroll Up" disabled={isSessionBusy || isLoadingMessages} > ↑ </button>
              <button className="button icon-button" onClick={scrollToNext} title="Scroll Down" disabled={isSessionBusy || isLoadingMessages} > ↓ </button>
            </div>
          </div>
          <div className="resizable-handle" onMouseDown={handleMouseDown} aria-hidden="true" />
          <div className="prompt-builder-area">
            <PromptBuilder
              mode={mode} setMode={setMode} form={form} setForm={setForm}
              sendDisabled={sendButtonDisplayInfo.disabled} sendButtonText={sendButtonDisplayInfo.text}
              handleSend={handleSend} showToast={Toast}
              imagePreviews={pendingImages} pdfPreviews={pendingPDFs}
              onRemoveImage={removePendingImage} onAddImage={addPendingImage} onAddPDF={addPendingPDF}
              settings={{ apiKey, model }}
              hasLastSendFailed={hasLastSendFailed}
              importedCodeFiles={stagedCodeFiles}
              onCodeFilesChange={setStagedCodeFiles}
              onClearCodebase={clearCodebaseImporterRef}
              currentChatId={currentChatId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ChatProvider>
      <MainLayout />
    </ChatProvider>
  );
}
