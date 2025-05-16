// src/components/ChatArea.jsx
/* --------------------------------------------------------------------
   ChatArea – controlled renderer for the whole conversation.
   Copy buttons now use the shared useCopyToClipboard hook.
---------------------------------------------------------------------*/
import { memo }       from 'preact/compat';
import MessageItem    from './MessageItem.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';

/* flatten block array → plain text */
function flattenContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return String(content ?? '');
}

function ChatArea({
  messages = [],

  /* edit / delete helpers & state from App */
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
  /* copy helper wired to global toast */
  const [copyMessage] = useCopyToClipboard({
    successMsg: 'Copied!',
    errorMsg:   'Copy failed',
    successMs:  1500,
    errorMs:    2000
  });

  return (
    <>
      {messages.map((m, idx) => {
        const isAsst     = m.role === 'assistant';
        const isLastUser = (
          m.role === 'user' &&
          idx === messages.length - 1 &&
          !editingId
        );

        const handleCopy = () => copyMessage(flattenContent(m.content));

        return (
          <div key={m.id} className={`message message-${m.role}`}>
            {/* floating Copy for assistant rows */}
            <div className="floating-controls">
              {isAsst && (
                <button
                  className="button icon-button"
                  title="Copy entire message"
                  onClick={handleCopy}
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
                  /* ── edit mode ── */
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
                  /* ── normal mode ─ */
                  <>
                    <button
                      className="button icon-button"
                      onClick={handleCopy}
                    >
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

/* ------------------------------------------------------------------
   Custom memo comparator:
   • First checks primitive props.
   • Then O(1) check on messages – if lengths differ OR last
     message id / content differ we re-render.
-------------------------------------------------------------------*/
function areEqual(prev, next) {
  if (prev.editingId   !== next.editingId)   return false;
  if (prev.editText    !== next.editText)    return false;
  if (prev.loadingSend !== next.loadingSend) return false;
  if (prev.savingEdit  !== next.savingEdit)  return false;

  const a = prev.messages;
  const b = next.messages;
  if (a === b) return true;          // identical reference

  if (a.length !== b.length) return false;
  if (a.length === 0)        return true;

  const al = a[a.length - 1];
  const bl = b[b.length - 1];
  return (
    al.id === bl.id &&
    JSON.stringify(al.content) === JSON.stringify(bl.content)
  );
}

export default memo(ChatArea, areEqual);