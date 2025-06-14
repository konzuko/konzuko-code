/* src/components/ChatArea.jsx */
// src/components/ChatArea.jsx
import { useEffect, useRef, useState } from 'preact/hooks';
import MessageItem from './MessageItem.jsx';
import ConfirmationModal from './ConfirmationModal.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import { autoResizeTextarea } from '../lib/domUtils.js';

const flatten = c =>
  Array.isArray(c)
    ? c.filter(b => b.type === 'text').map(b => b.text).join('')
    : String(c ?? '');

function ChatArea({
  messages = [],
  isLoading,
  forceLoading,
  editingId,
  editText,
  loadingSend,
  savingEdit,
  setEditText,
  handleSaveEdit,
  handleCancelEdit,
  handleStartEdit,
  handleResendMessage,
  handleDeleteMessage,
  actionsDisabled
}) {
  const [copyMessage] = useCopyToClipboard();
  const editingTextareaRef = useRef(null);
  const [forkingMessage, setForkingMessage] = useState(null);
  let assistantMessageCounter = 0;

  const MAX_EDIT_TEXTAREA_HEIGHT = 200; // px
  const showThinkingSpinner = loadingSend && messages.length > 0 && messages[messages.length - 1].role === 'user' && !editingId;

  useEffect(() => {
    if (editingId && editingTextareaRef.current) {
      autoResizeTextarea(editingTextareaRef.current, MAX_EDIT_TEXTAREA_HEIGHT);
    }
  }, [editingId, editText]);

  if (forceLoading || isLoading) {
    return <div className="chat-loading-placeholder">Loading messages...</div>;
  }

  if (!messages || messages.length === 0) {
    return <div className="chat-empty-placeholder">No messages in this chat yet. Send one!</div>;
  }

  const lastUserMessageIndex = messages.map(m => m.role).lastIndexOf('user');

  return (
    <>
      {messages.map((m, idx) => {
        const isUser = m.role === 'user';
        const isAsst = m.role === 'assistant';
        let currentAssistantNumber = 0;

        if (isAsst) {
          assistantMessageCounter++;
          currentAssistantNumber = assistantMessageCounter;
        }

        const isLastUserMessage = isUser && idx === lastUserMessageIndex;
        const doCopy = () => copyMessage(flatten(m.content));
        const currentMessageIsBeingEdited = m.id === editingId;

        return (
          <div key={m.id} className={`message message-${m.role}`}>
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
                {isAsst ? ( <><span className="assistant-message-number">#{currentAssistantNumber}</span> assistant</> ) : m.role }
              </span>
              <div className="message-actions">
                {currentMessageIsBeingEdited ? (
                  <>
                    <button
                      className="button"
                      disabled={savingEdit || actionsDisabled}
                      onClick={handleSaveEdit}
                    >
                      {savingEdit ? 'Processing…' : 'Save'}
                    </button>
                    <button
                      className="button"
                      disabled={actionsDisabled}
                      onClick={handleCancelEdit}
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
                        {/* Only show Edit on the last user message */}
                        {isLastUserMessage && (
                          <button
                            className="button icon-button"
                            disabled={loadingSend || actionsDisabled}
                            onClick={() => handleStartEdit(m)}
                            title="Edit message"
                          >
                            Edit
                          </button>
                        )}
                        {/* Show Fork on any user message that is NOT the last one */}
                        {!isLastUserMessage && (
                           <button
                            className="button icon-button"
                            disabled={loadingSend || actionsDisabled}
                            onClick={() => setForkingMessage(m)}
                            title="Fork conversation from this point"
                          >
                            Fork
                          </button>
                        )}
                      </>
                    )}
                    {isLastUserMessage && (
                      <button
                        className="button icon-button"
                        disabled={loadingSend || actionsDisabled}
                        onClick={() => handleResendMessage(m.id)}
                        title="Resend message"
                      >
                        Resend
                      </button>
                    )}
                    {handleDeleteMessage && (
                        <button
                          className="button icon-button"
                          disabled={loadingSend || actionsDisabled}
                          onClick={() => handleDeleteMessage(m.id)}
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
                  disabled={loadingSend || actionsDisabled}
                  onClick={() => handleResendMessage(m.id)}
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
        onConfirm={() => handleStartEdit(forkingMessage)}
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
    </>
  );
}

export default ChatArea;