// src/components/ChatArea.jsx
import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import MessageItem from './MessageItem.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import { getChecksum } from '../lib/checksumCache.js';
import { autoResizeTextarea } from '../lib/domUtils.js';

const flatten = c =>
  Array.isArray(c)
    ? c.filter(b => b.type === 'text').map(b => b.text).join('')
    : String(c ?? '');

function ChatArea({
  messages = [],
  isLoading,
  forceLoading, // New prop: If true, always show loading state initially
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
  let assistantMessageCounter = 0;

  const MAX_EDIT_TEXTAREA_HEIGHT = 200; // px
  // Determine if the "thinking" spinner should be shown
  const showThinkingSpinner = loadingSend && messages.length > 0 && messages[messages.length - 1].role === 'user' && !editingId;

  useEffect(() => {
    if (editingId && editingTextareaRef.current) {
      autoResizeTextarea(editingTextareaRef.current, MAX_EDIT_TEXTAREA_HEIGHT);
    }
  }, [editingId, editText]);

  if (forceLoading || isLoading) { // Prioritize forceLoading
    return <div className="chat-loading-placeholder">Loading messages...</div>;
  }

  if (!messages || messages.length === 0) {
    return <div className="chat-empty-placeholder">No messages in this chat yet. Send one!</div>;
  }

  return (
    <>
      {messages.map((m, idx) => {
        const isAsst = m.role === 'assistant';
        let currentAssistantNumber = 0;

        if (isAsst) {
          assistantMessageCounter++;
          currentAssistantNumber = assistantMessageCounter;
        }

        const isLastUser = m.role === 'user' &&
                           idx === messages.length - 1 &&
                           !editingId;

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
                    {isLastUser && (
                      <>
                        <button
                          className="button icon-button"
                          disabled={loadingSend || actionsDisabled}
                          onClick={() => handleStartEdit(m)}
                          title="Edit message"
                        >
                          Edit
                        </button>
                        <button
                          className="button icon-button"
                          disabled={loadingSend || actionsDisabled}
                          onClick={() => handleResendMessage(m.id)}
                          title="Resend message"
                        >
                          Resend
                        </button>
                      </>
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
            {isLastUser && !currentMessageIsBeingEdited && (
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
    </>
  );
}

function areEqual(prev, next) {
  if (prev.forceLoading !== next.forceLoading) return false;
  if (prev.isLoading !== next.isLoading) return false;
  if (prev.editingId   !== next.editingId)   return false;
  if (prev.editText    !== next.editText)    return false;
  if (prev.loadingSend !== next.loadingSend) return false;
  if (prev.savingEdit  !== next.savingEdit)  return false;
  if (prev.actionsDisabled !== next.actionsDisabled) return false;

  if (next.forceLoading || next.isLoading) {
    return prev.forceLoading === next.forceLoading &&
           prev.isLoading === next.isLoading &&
           prev.editingId === next.editingId &&
           prev.editText === next.editText &&
           prev.loadingSend === next.loadingSend &&
           prev.savingEdit === next.savingEdit &&
           prev.actionsDisabled === next.actionsDisabled;
  }

  if (prev.messages === next.messages) return true;
  if (!prev.messages && !next.messages) return true;
  if (!prev.messages || !next.messages) return false;
  if (prev.messages.length !== next.messages.length) return false;
  if (prev.messages.length === 0 && next.messages.length === 0) return true;

  for (let i = 0; i < prev.messages.length; i++) {
    if (prev.messages[i].id !== next.messages[i].id) return false;
    if (getChecksum(prev.messages[i]) !== getChecksum(next.messages[i])) return false;
  }
  return true;
}

export default memo(ChatArea, areEqual);
