// file: src/components/ChatArea.jsx
import { useEffect, useRef, useState } from 'preact/hooks'; // <-- FIX: Removed useMemo
import MessageItem from './MessageItem.jsx';
import ConfirmationModal from './ConfirmationModal.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import { autoResizeTextarea } from '../lib/domUtils.js';
import { useChat } from '../contexts/ChatContext.jsx';
import { useSettings } from '../contexts/SettingsContext.jsx';

const flatten = c =>
  Array.isArray(c)
    ? c.filter(b => b.type === 'text').map(b => b.text).join('')
    : String(c ?? '');

export default function ChatArea({ actionsDisabled }) { // <-- FIX: Removed forceLoading prop
  const {
    messages,
    isLoadingMessages,
    editingId,
    editText,
    setEditText,
    startEdit,
    cancelEdit,
    saveEdit,
    resendMessage,
    deleteMessage,
    isSendingMessage,
    isForking,
  } = useChat();
  
  const { apiKey } = useSettings();

  const [copyMessage] = useCopyToClipboard();
  const editingTextareaRef = useRef(null);
  const [forkingMessage, setForkingMessage] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const chatAreaRef = useRef(null);

  const MAX_EDIT_TEXTAREA_HEIGHT = 200;
  const showThinkingSpinner = isSendingMessage && messages.length > 0 && messages[messages.length - 1].role === 'user' && !editingId;

  useEffect(() => {
    if (editingId && editingTextareaRef.current) {
      autoResizeTextarea(editingTextareaRef.current, MAX_EDIT_TEXTAREA_HEIGHT);
    }
  }, [editingId, editText]);

  useEffect(() => {
    const area = chatAreaRef.current;
    if (!area) return;

    const handleCopyEvent = (e) => {
      const messageDiv = e.target.closest('.message');
      if (messageDiv && messageDiv.dataset.messageId) {
        setHighlightedId(messageDiv.dataset.messageId);
        setTimeout(() => setHighlightedId(null), 800);
      }
    };

    area.addEventListener('konzuko:copy', handleCopyEvent);
    return () => area.removeEventListener('konzuko:copy', handleCopyEvent);
  }, []);

  // --- FIX: Simplified loading check ---
  if (isLoadingMessages) {
    return <div className="chat-loading-placeholder">Loading messages...</div>;
  }
  // --- END FIX ---

  if (!messages || messages.length === 0) {
    return <div className="chat-empty-placeholder">No messages in this chat yet. Send one!</div>;
  }

  // --- FIX: Removed useMemo for processedMessages. Calculation is now done in the render loop. ---
  const lastUserMessageIndex = messages.map(m => m.role).lastIndexOf('user');
  let assistantCounter = 0; // Counter for assistant messages
  // --- END FIX ---

  return (
    <div ref={chatAreaRef}>
      {messages.map((m, idx) => { // Map over the original messages array
        const isUser = m.role === 'user';
        const isAsst = m.role === 'assistant';

        // Increment counter for each assistant message
        if (isAsst) {
          assistantCounter++;
        }
        const assistantNumber = isAsst ? assistantCounter : 0;

        const isLastUserMessage = isUser && idx === lastUserMessageIndex;
        const doCopy = (e) => {
          copyMessage(flatten(m.content));
          e.currentTarget.dispatchEvent(new CustomEvent('konzuko:copy', { bubbles: true }));
        };
        const currentMessageIsBeingEdited = m.id === editingId;

        return (
          <div key={m.id} data-message-id={m.id} className={`message message-${m.role} ${m.id === highlightedId ? 'highlight-on-copy' : ''}`}>
            <div className="floating-controls">
              {isAsst && !actionsDisabled && (
                <button
                  className="button icon-button"
                  title="Copy entire message"
                  onClick={doCopy}
                >
                  Copy
                </button>
              )}
            </div>
            <div className="message-header">
              <span className="message-role">
                {isAsst ? ( <><span className="assistant-message-number">#{assistantNumber}</span> assistant</> ) : m.role }
              </span>
              <div className="message-actions">
                {currentMessageIsBeingEdited ? (
                  <>
                    <button
                      className="button"
                      disabled={isForking || actionsDisabled}
                      onClick={() => saveEdit(apiKey)}
                    >
                      {isForking ? 'Processing…' : 'Save'}
                    </button>
                    <button
                      className="button"
                      disabled={actionsDisabled}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button icon-button" onClick={doCopy} title="Copy message text" disabled={actionsDisabled}>
                      Copy
                    </button>
                    {isUser && (
                      <>
                        {isLastUserMessage && (
                          <button
                            className="button icon-button"
                            disabled={isSendingMessage || actionsDisabled}
                            onClick={() => startEdit(m)}
                            title="Edit message"
                          >
                            Edit
                          </button>
                        )}
                        {!isLastUserMessage && (
                           <button
                            className="button icon-button"
                            disabled={isSendingMessage || actionsDisabled}
                            onClick={() => setForkingMessage(m)}
                            title="Fork/Edit conversation from this point"
                          >
                            Fork/Edit
                          </button>
                        )}
                      </>
                    )}
                    {isLastUserMessage && (
                      <button
                        className="button icon-button"
                        disabled={isSendingMessage || actionsDisabled}
                        onClick={() => resendMessage(m.id, apiKey)}
                        title="Resend message"
                      >
                        Resend
                      </button>
                    )}
                    {deleteMessage && (
                        <button
                          className="button icon-button"
                          disabled={isSendingMessage || actionsDisabled}
                          onClick={() => deleteMessage(m.id)}
                          title="Delete message"
                        >
                          Del
                        </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="message-content">
              {currentMessageIsBeingEdited ? (
                <textarea
                  ref={editingTextareaRef}
                  rows={3}
                  className="editing-textarea"
                  style={{ maxHeight: `${MAX_EDIT_TEXTAREA_HEIGHT}px` }}
                  value={editText}
                  onInput={e => {
                    setEditText(e.target.value);
                    autoResizeTextarea(e.target, MAX_EDIT_TEXTAREA_HEIGHT);
                  }}
                />
              ) : (
                <MessageItem m={m} />
              )}
            </div>
            {isLastUserMessage && !currentMessageIsBeingEdited && (
              <div className="message-bottom-actions">
                <button
                  className="button icon-button resend-button-bottom"
                  disabled={isSendingMessage || actionsDisabled}
                  onClick={() => resendMessage(m.id, apiKey)}
                  title="Resend message"
                >
                  Resend
                </button>
              </div>
            )}
          </div>
        );
      })}
      {showThinkingSpinner && (
        <div className="message message-assistant message-thinking">
          <div className="message-content-inner">
            <div className="thinking-spinner">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}
      <ConfirmationModal
        isOpen={!!forkingMessage}
        onClose={() => setForkingMessage(null)}
        onConfirm={() => startEdit(forkingMessage)}
        title="Fork Conversation?"
        confirmationText="fork"
        confirmButtonText="Fork"
      >
        <p>
          Forking will KEEP this current message but REMOVE all messages after it.
        </p>
        <p>
          This action is destructive and can be undone for a short time via the notification that will appear.
        </p>
      </ConfirmationModal>
    </div>
  );
}
