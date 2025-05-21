// src/components/ChatArea.jsx
import { memo } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import MessageItem from './MessageItem.jsx';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import { getChecksum } from '../lib/checksumCache.js';

const flatten = c =>
  Array.isArray(c)
    ? c.filter(b => b.type === 'text').map(b => b.text).join('')
    : String(c ?? '');

const autoResizeTextarea = (textarea, maxHeight) => {
  if (textarea) {
    textarea.style.overflowY = 'hidden'; // Prevent scrollbar flash during calculation
    textarea.style.height = 'auto';    // Reset height to get accurate scrollHeight

    const computedStyle = getComputedStyle(textarea);
    const paddingTop = parseFloat(computedStyle.paddingTop);
    const paddingBottom = parseFloat(computedStyle.paddingBottom);
    const borderTop = parseFloat(computedStyle.borderTopWidth);
    const borderBottom = parseFloat(computedStyle.borderBottomWidth);
    
    // scrollHeight includes padding but not border for some browsers if box-sizing is border-box
    // For simplicity, we'll assume scrollHeight is mostly content.
    // A more precise calculation might involve clientHeight vs scrollHeight and boxSizing.
    const currentScrollHeight = textarea.scrollHeight;
    
    if (maxHeight && currentScrollHeight > maxHeight) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = 'auto'; 
    } else {
      // Ensure a minimum height based on `rows` attribute if scrollHeight is less
      const minRows = parseInt(textarea.getAttribute('rows') || '1', 10);
      const lineHeight = parseFloat(computedStyle.lineHeight);
      // Approximate min height based on rows, line height, padding, and border
      const minHeightBasedOnRows = (minRows * lineHeight) + paddingTop + paddingBottom + borderTop + borderBottom;
      
      textarea.style.height = `${Math.max(currentScrollHeight, minHeightBasedOnRows)}px`;
      // If not exceeding max height, keep overflow hidden unless it's naturally scrollable due to minHeight
      if (textarea.scrollHeight > parseFloat(textarea.style.height)) {
          textarea.style.overflowY = 'auto';
      } else {
          textarea.style.overflowY = 'hidden';
      }
    }
  }
};


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
  handleDeleteMessage,
  actionsDisabled 
}) {
  const [copyMessage] = useCopyToClipboard();
  const editingTextareaRef = useRef(null);
  let assistantMessageCounter = 0;

  const MAX_EDIT_TEXTAREA_HEIGHT = 200; // px

  useEffect(() => {
    if (editingId && editingTextareaRef.current) {
      autoResizeTextarea(editingTextareaRef.current, MAX_EDIT_TEXTAREA_HEIGHT);
      // editingTextareaRef.current.focus(); 
      // editingTextareaRef.current.select(); 
    }
  }, [editingId, editText]); 

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
                      {savingEdit ? 'Saving…' : 'Save'}
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
                  className="editing-textarea" // Use class for styling
                  style={{ maxHeight: `${MAX_EDIT_TEXTAREA_HEIGHT}px` }} // Inline max-height for JS to also use
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
  if (prev.actionsDisabled !== next.actionsDisabled) return false; 

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
