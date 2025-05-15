/* --------------------------------------------------------------------
   ChatArea – controlled full-DOM renderer
   • Uses <MessageItem> to display cached Markdown→HTML.
   • Memoised with a comparator that is now resilient against accidental
     in-place mutation of the messages array and also watches loadingSend
     & savingEdit so the action buttons enable/disable instantly.
---------------------------------------------------------------------*/
import { memo }          from 'preact/compat';
import MessageItem       from './MessageItem.jsx';
import Toast             from './Toast.jsx';
import { copyToClipboard } from '../lib/copy.js';

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
  /* helper: copy entire plain-text message */
  async function copyMessage(m) {
    const txt = Array.isArray(m.content)
      ? m.content.filter(b => b.type === 'text').map(b => b.text).join('')
      : String(m.content);

    const ok = await copyToClipboard(txt);
    if (!ok) Toast('Copy failed', 2000);
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
                  /* ── normal mode ── */
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

/* ------------------------------------------------------------------
   Custom memo comparator:
   • First checks primitive props.
   • Then cheap O(1) check on messages – if lengths differ OR last
     message id / checksum differ we re-render.
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
  return al.id === bl.id && al.checksum === bl.checksum;
}

export default memo(ChatArea, areEqual);
