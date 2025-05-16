// src/components/ChatArea.jsx
/* --------------------------------------------------------------------
   ChatArea – renders the conversation list
---------------------------------------------------------------------*/
import { memo }             from 'preact/compat';
import MessageItem          from './MessageItem.jsx';
import useCopyToClipboard   from '../hooks/useCopyToClipboard.js';
import { getChecksum }      from '../lib/checksumCache.js';

/* flatten helper */
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
  handleDeleteMessage
}) {
  const [copyMessage] = useCopyToClipboard();

  return (
    <>
      {messages.map((m, idx) => {
        const isAsst     = m.role === 'assistant';
        const isLastUser = m.role === 'user' &&
                           idx === messages.length - 1 &&
                           !editingId;

        const doCopy = () => copyMessage(flatten(m.content));

        return (
          <div key={m.id} className={`message message-${m.role}`}>
            {/* floating Copy for assistant rows */}
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

            {/* header */}
            <div className="message-header">
              <span className="message-role">
                {isAsst ? `assistant #${idx}` : m.role}
              </span>

              <div className="message-actions">
                {m.id === editingId ? (
                  <>
                    <button
                      className="button"
                      disabled={loadingSend || savingEdit}
                      onClick={handleSaveEdit}
                    >
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="button"
                      disabled={loadingSend}
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button icon-button" onClick={doCopy}>
                      Copy
                    </button>

                    {isLastUser && (
                      <>
                        <button
                          className="button icon-button"
                          disabled={loadingSend}
                          onClick={() => handleStartEdit(m)}
                        >
                          Edit
                        </button>
                        <button
                          className="button icon-button"
                          disabled={loadingSend}
                          onClick={() => handleResendMessage(m.id)}
                        >
                          Resend
                        </button>
                      </>
                    )}

                    <button
                      className="button icon-button"
                      disabled={loadingSend}
                      onClick={() => handleDeleteMessage(m.id)}
                    >
                      Del
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* body */}
            <div className="message-content">
              {m.id === editingId ? (
                <textarea
                  rows={4}
                  style={{ width: '100%' }}
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

/* memo comparator using WeakMap checksum */
function areEqual(prev, next) {
  if (prev.editingId   !== next.editingId)   return false;
  if (prev.editText    !== next.editText)    return false;
  if (prev.loadingSend !== next.loadingSend) return false;
  if (prev.savingEdit  !== next.savingEdit)  return false;

  const a = prev.messages;
  const b = next.messages;
  if (a === b) return true;

  if (a.length !== b.length) return false;
  if (!a.length)             return true;

  const al = a[a.length - 1];
  const bl = b[b.length - 1];
  return al.id === bl.id && getChecksum(al) === getChecksum(bl);
}

export default memo(ChatArea, areEqual);