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
  loadingSend,
  savingEdit,
  setEditText,
  handleSaveEdit,
  handleCancelEdit,
  handleStartEdit,
  handleResendMessage,
  handleDeleteMessage // Receives handleDeleteMessageTrigger from App.jsx
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

        return (
          <div key={m.id} className={`message message-${m.role}`}> 
            <div className="floating-controls">
              {isAsst && (
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
                {isAsst ? (
                  <>
                    <span className="assistant-message-number">#{currentAssistantNumber}</span>
                    {' assistant'}
                  </>
                ) : (
                  m.role
                )}
              </span>
              <div className="message-actions">
                {m.id === editingId ? (
                  <>
                    <button
                      className="button"
                      disabled={loadingSend || savingEdit}
                      onClick={handleSaveEdit} // This will call App's handleSaveEdit
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="button"
                      disabled={loadingSend} // Ensure this is connected to the edit mutation's pending state
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button icon-button" onClick={doCopy} title="Copy message text">
                      Copy
                    </button>
                    {isLastUser && (
                      <>
                        <button
                          className="button icon-button"
                          disabled={loadingSend} // Ensure this is connected to app-wide busy or specific edit states
                          onClick={() => handleStartEdit(m)}
                          title="Edit message"
                        >
                          Edit
                        </button>
                        <button
                          className="button icon-button"
                          disabled={loadingSend} // Ensure this is connected to app-wide busy or specific resend states
                          onClick={() => handleResendMessage(m.id)} // Calls App's handleResendMessage
                          title="Resend message"
                        >
                          Resend
                        </button>
                      </>
                    )}
                    {handleDeleteMessage && ( // Conditionally render if handler is provided
                        <button
                          className="button icon-button"
                          disabled={loadingSend} // Or a message-specific delete pending state
                          onClick={() => handleDeleteMessage(m.id)} // Calls App's handleDeleteMessageTrigger
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
              {m.id === editingId ? (
                <textarea
                  rows={5} // Slightly larger
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

// Memoization: TQ usually ensures stable data references if data hasn't changed.
// This custom comparator can be useful if props other than `messages` change frequently
// and you want to avoid re-renders based on deep message content.
// However, if `messages` is the primary driver, TQ's default behavior + React.memo might be enough.
function areEqual(prev, next) {
  if (prev.editingId   !== next.editingId)   return false;
  if (prev.editText    !== next.editText)    return false;
  if (prev.loadingSend !== next.loadingSend) return false; // From App.jsx (sendMessageMutation.isPending)
  if (prev.savingEdit  !== next.savingEdit)  return false; // From App.jsx (editMessageMutation.isPending)

  if (prev.messages === next.messages) return true; // Quick exit if reference is same
  if (prev.messages.length !== next.messages.length) return false;
  if (!prev.messages.length && !next.messages.length) return true;

  // More robust check if message content itself can change without ID changing (e.g. streaming)
  // or if order can change. For TQ, usually the array reference changes if content changes.
  for (let i = 0; i < prev.messages.length; i++) {
    if (prev.messages[i].id !== next.messages[i].id) return false;
    // Only compare checksum if IDs are same but content might differ (e.g. if content is mutable)
    // If TQ guarantees new message objects for new content, ID check is often enough.
    if (getChecksum(prev.messages[i]) !== getChecksum(next.messages[i])) return false;
  }
  return true;
}

export default memo(ChatArea, areEqual);
