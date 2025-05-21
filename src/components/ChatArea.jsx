// src/components/ChatArea.jsx
import { memo } from 'preact/compat';
import MessageItem from './MessageItem.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import { getChecksum } from '../lib/checksumCache.js';

const flatten = c =>
  Array.isArray(c)
    ? c.filter(b => b.type === 'text').map(b => b.text).join('')
    : String(c ?? '');

function ChatArea({
  messages = [],
  editingId,
  editText,
  loadingSend, // This now reflects a broader "busy" state for sending/editing/resending
  savingEdit,  // Specifically for the "Save" button when editing
  setEditText,
  handleSaveEdit,
  handleCancelEdit,
  handleStartEdit,
  handleResendMessage,
  handleDeleteMessage,
  actionsDisabled // New prop to disable all actions if App is globally busy
}) {
  const [copyMessage] = useCopyToClipboard();
  let assistantMessageCounter = 0;

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
              {isAsst && !actionsDisabled && ( // Check actionsDisabled
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
                {isAsst ? ( /* ... role display ... */ <><span className="assistant-message-number">#{currentAssistantNumber}</span> assistant</> ) : m.role }
              </span>
              <div className="message-actions">
                {currentMessageIsBeingEdited ? (
                  <>
                    <button
                      className="button"
                      disabled={savingEdit || actionsDisabled} // Use savingEdit for this specific button
                      onClick={handleSaveEdit}
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="button"
                      disabled={actionsDisabled} // General disable
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
                          disabled={loadingSend || actionsDisabled} // loadingSend covers send/edit/resend
                          onClick={() => handleStartEdit(m)}
                          title="Edit message"
                        >
                          Edit
                        </button>
                        <button
                          className="button icon-button"
                          disabled={loadingSend || actionsDisabled} // loadingSend covers send/edit/resend
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
                          disabled={loadingSend || actionsDisabled} // loadingSend covers send/edit/resend/delete
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
                  rows={5}
                  style={{ width: '100%', fontSize: '0.95rem', padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  value={editText}
                  onInput={e => setEditText(e.target.value)}
                />
              ) : (
                <MessageItem m={m} />
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function areEqual(prev, next) {
  if (prev.editingId   !== next.editingId)   return false;
  if (prev.editText    !== next.editText)    return false;
  if (prev.loadingSend !== next.loadingSend) return false;
  if (prev.savingEdit  !== next.savingEdit)  return false;
  if (prev.actionsDisabled !== next.actionsDisabled) return false; // Check new prop

  if (prev.messages === next.messages) return true;
  if (prev.messages.length !== next.messages.length) return false;
  if (!prev.messages.length && !next.messages.length) return true;

  for (let i = 0; i < prev.messages.length; i++) {
    if (prev.messages[i].id !== next.messages[i].id) return false;
    if (getChecksum(prev.messages[i]) !== getChecksum(next.messages[i])) return false;
  }
  return true;
}

export default memo(ChatArea, areEqual);
