// file: src/contexts/ChatContext.jsx
import { createContext, useContext } from 'preact/compat';
import { useState, useMemo } from 'preact/hooks';
import { useChatSessionManager } from '../hooks/useChatSessionManager.js';
import { useMessageManager } from '../hooks/useMessageManager.js';
import { useSettings } from './SettingsContext.jsx';

const ChatContext = createContext(null);
ChatContext.displayName = 'ChatContext';

// HMR FIX: Changed from "export const ChatProvider" to "export default function ChatProvider"
// This makes ChatProvider the default export, allowing the named export `useChat` to coexist.
export default function ChatProvider({ children }) {
  const [hasLastSendFailed, setHasLastSendFailed] = useState(false);
  const { isApiKeyLoading } = useSettings();

  const sessionManager = useChatSessionManager();
  const messageManager = useMessageManager(sessionManager.currentChatId, setHasLastSendFailed);

  const isBusy = useMemo(() => 
    sessionManager.isSessionBusy || messageManager.isLoadingOps || isApiKeyLoading,
    [sessionManager.isSessionBusy, messageManager.isLoadingOps, isApiKeyLoading]
  );

  const value = {
    // Session Management
    ...sessionManager,
    // Message Management
    ...messageManager,
    // Local State
    hasLastSendFailed,
    setHasLastSendFailed,
    // Combined Busy State
    isBusy,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === null) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
