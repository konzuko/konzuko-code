/* --------------------------------------------------------------------
   ChatArea – controlled full-DOM renderer
   • Uses <MessageItem> for cached HTML so Markdown is not re-parsed.
   • Wrapped in memo(); re-renders only when messages reference,
     editingId or editText change.
---------------------------------------------------------------------*/
import { memo }      from 'preact/compat';
import MessageItem   from './MessageItem.jsx';
import Toast         from './Toast.jsx';

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
  /* helper to copy entire msg text */
  function copyMessage(m) {
    const txt = Array.isArray(m.content)
      ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : String(m.content);
    navigator.clipboard.writeText(txt).catch(() => {
      Toast('Copy failed', 2000);
    });
  }

  return (
    <>
      {messages.map((m, idx) => {
        const isAsst     = m.role === 'assistant';
        const isLastUser = (
          m.role === 'user' &&
          idx === messages.length - 1 &&
          !editingId
        );

        return (
          <div key={m.id} className={`message message-${m.role}`}>
            {/* floating Copy for assistant rows */}
            <div className="floating-controls">
              {isAsst && (
                <button
                  className="button icon-button"
                  title="Copy entire message"
                  onClick={() => copyMessage(m)}
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
                    <button
                      className="button icon-button"
                      onClick={() => copyMessage(m)}
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

/* comparator – re-render only when these primitives actually change */
export default memo(ChatArea, (a, b) =>
  a.messages   === b.messages   &&
  a.editingId  === b.editingId  &&
  a.editText   === b.editText
);
