import { useState, useEffect, useRef } from 'preact/hooks';
import ChatPane from './chatpane.jsx';
import { callApiForText /*, callApiForImageDescription*/ } from './api.js';
import {
  useChats,
  useSettings,
  useFormData,
  useDroppedFiles,
  useMode,
  approximateTokenCount
} from './hooks.js';

// Helper function to read a File as a base64 data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(evt.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// Define the default return format value.
const DEFAULT_RETURN_FORMAT =
  "return complete refactored code in FULL so that i can paste it directly into my ide";

function App() {
  const { chats, addChat, updateChat, deleteChat } = useChats();
  const [settings, setSettings] = useSettings();
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useMode();
  const [formData, setFormData] = useFormData();
  const [droppedFiles, setDroppedFiles] = useDroppedFiles();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [chatToDelete, setChatToDelete] = useState(null);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const fileInputRef = useRef();
  const [loading, setLoading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [hasEditedReturnFormat, setHasEditedReturnFormat] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────────
  // Utility functions to render or copy message content in a user-friendly way
  // ─────────────────────────────────────────────────────────────────────────────
  function renderMessageContent(content) {
    // If there's no array of objects, just display as text.
    if (typeof content === 'string') {
      return <div>{content}</div>;
    }
    // If there's an array of content parts (e.g. text and images), render each appropriately
    if (Array.isArray(content)) {
      return content.map((item, idx) => {
        if (item.type === 'text') {
          return (
            <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>
              {item.text}
            </div>
          );
        } else if (item.type === 'image_url') {
          return (
            <div key={idx} style={{ marginTop: '0.5em', marginBottom: '0.5em' }}>
              <img
                src={item.image_url.url}
                alt="User Uploaded"
                style={{ maxWidth: '300px', maxHeight: '300px' }}
              />
            </div>
          );
        } else {
          // fallback if there's some other type
          return (
            <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(item, null, 2)}
            </div>
          );
        }
      });
    }
    // fallback if it's an object or something else
    return <div>{JSON.stringify(content, null, 2)}</div>;
  }

  function getMessagePlainText(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      // For copying to clipboard, we'll just show text for text parts,
      // and a placeholder for images, so we don't expose base64 data
      return content
        .map((item) => {
          if (item.type === 'text') {
            return item.text;
          } else if (item.type === 'image_url') {
            return '[Image]';
          } else {
            return JSON.stringify(item);
          }
        })
        .join('\n');
    }
    return JSON.stringify(content, null, 2);
  }

  // Ensure at least one chat exists
  useEffect(() => {
    if (chats.length === 0) {
      handleNewChat();
    } else if (currentChatId === null && chats.length > 0) {
      setCurrentChatId(chats[0].id);
    }
  }, [chats]);

  // ─── Drag & Drop Helpers ─────────────────────────────
  function isTextFile(file) {
    const allowedExtensions = ['.txt', '.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.html', '.css', '.md'];
    if (file.type.startsWith('text/')) return true;
    const lowerName = file.name.toLowerCase();
    return allowedExtensions.some(ext => lowerName.endsWith(ext));
  }

  function handleTextareaDrop(fieldName, event) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    for (const file of files) {
      if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const textContent = e.target.result;
          const filePath = file.path || file.name;
          setFormData(prev => ({
            ...prev,
            [fieldName]: prev[fieldName] + "\n/* Content from " + filePath + " */\n" + textContent
          }));
          setDroppedFiles(prev => ({
            ...prev,
            [fieldName]: [...(prev[fieldName] || []), filePath]
          }));
        };
        reader.readAsText(file);
      }
    }
  }

  async function handleTemplateDragOver(e) {
    e.preventDefault();
  }

  async function handleTemplateDrop(e) {
    e.preventDefault();
    if (e.target.tagName !== 'TEXTAREA') {
      const files = e.dataTransfer.files;
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          try {
            const dataUrl = await readFileAsDataURL(file);
            setUploadedImages(prev => [...prev, { dataUrl, name: file.name, size: file.size }]);
          } catch (err) {
            console.error('Error reading image file:', err);
          }
        }
      }
    }
  }

  async function handleFileSelection(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await readFileAsDataURL(file);
          setUploadedImages(prev => [...prev, { dataUrl, name: file.name, size: file.size }]);
        } catch (err) {
          console.error('Error reading image file:', err);
        }
      }
    }
  }

  function removeUploadedImage(index) {
    setUploadedImages(prev => {
      const newImages = [...prev];
      newImages.splice(index, 1);
      return newImages;
    });
  }

  // ─── Chat Title Handlers ─────────────────────────────
  function handleTitleUpdate(chatId, newTitle) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    updateChat({ ...chat, title: newTitle });
  }

  // ─── New Chat Handler ─────────────────────────────
  function handleNewChat() {
    const newChat = {
      id: Date.now() + '-' + Math.random().toString(36).substring(2, 9),
      title: 'New Chat',
      started: new Date().toISOString(),
      messages: [
        {
          role: 'assistant',
          content: 'Hello! Welcome to Konzuko Code. How may I assist you today?'
        }
      ],
      model: settings.model,
    };
    addChat(newChat);
    setCurrentChatId(newChat.id);
  }

  function handleSelectChat(id) {
    setCurrentChatId(id);
  }

  function handleSettingsSave(e) {
    e.preventDefault();
    setShowSettings(false);
  }

  // ─── Chat Deletion Confirmation ─────────────────────────────
  function requestDeleteChat(chatId) {
    setChatToDelete(chatId);
  }

  function requestDeleteMessage(chatId, messageIndex) {
    setMessageToDelete({ chatId, messageIndex });
  }

  function confirmDeleteMessage() {
    if (!messageToDelete) return;
    const chat = chats.find(c => c.id === messageToDelete.chatId);
    if (chat) {
      const newMessages = chat.messages.filter((_, idx) => idx !== messageToDelete.messageIndex);
      updateChat({ ...chat, messages: newMessages });
    }
    setMessageToDelete(null);
  }

  async function handleResendMessage(messageIndex) {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || messageIndex >= chat.messages.length) return;
    if (chat.messages[messageIndex].role !== 'user') return;
    if (messageIndex < chat.messages.length - 1) return;

    setLoading(true);
    try {
      const result = await callApiForText({
        messages: chat.messages.slice(0, messageIndex + 1),
        apiKey: settings.apiKey,
        model: settings.model
      });
      let newMessages;
      if (result.error) {
        newMessages = [...chat.messages, { role: 'assistant', content: `Error: ${result.error}` }];
      } else {
        newMessages = [...chat.messages, { role: 'assistant', content: result.content || '' }];
      }
      updateChat({ ...chat, messages: newMessages });
    } finally {
      setLoading(false);
    }
  }

  function confirmDeleteChat() {
    if (!chatToDelete) return;
    deleteChat(chatToDelete);
    setChatToDelete(null);
    if (currentChatId === chatToDelete && chats.length > 1) {
      const remainingChats = chats.filter(c => c.id !== chatToDelete);
      if (remainingChats.length > 0) {
        setCurrentChatId(remainingChats[0].id);
      } else {
        setCurrentChatId(null);
      }
    } else if (chats.length === 1) {
      handleNewChat();
    }
  }

  // ─── Prompt Sending Function ─────────────────────────────
  async function handleSendPrompt() {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    // If in REVERT mode, we handle revert logic first
    if (mode === 'REVERT') {
      if (!confirmRevert) {
        setConfirmRevert(true);
        return;
      } else {
        const newMessages = chat.messages.slice(0, chat.messages.length - 1);
        updateChat({ ...chat, messages: newMessages });
        setConfirmRevert(false);
        return;
      }
    }

    // Build the text portion of the user's message
    let userContent = '';

    if (mode === 'DEVELOP') {
      const isFirstMessage = chat.messages.length === 0;
      const returnFormat = hasEditedReturnFormat ? formData.developReturnFormat : DEFAULT_RETURN_FORMAT;
      userContent = `
MODE: DEVELOP
GOAL: ${formData.developGoal}
FEATURES: ${formData.developFeatures}
RETURN FORMAT: ${returnFormat}
THINGS TO REMEMBER/WARNINGS: ${formData.developWarnings}
CONTEXT: ${formData.developContext}
${isFirstMessage ? 'PLAN: At the end, create a comprehensive plan.' : ''}
      `.trim();

      if (!formData.developGoal.trim()) {
        alert('The GOAL field is required for DEVELOP.');
        return;
      }
    } else if (mode === 'FIX') {
      userContent = `
MODE: FIX
FIX YOUR CODE: ${formData.fixCode}
ANY ERRORS?: ${formData.fixErrors}
      `.trim();
    }

    if (!userContent.trim() && uploadedImages.length === 0) {
      // If there's no text AND no images, abort
      return;
    }

    // Combine user text + images into one user message
    const messageContent = [];
    if (userContent.trim()) {
      messageContent.push({ type: 'text', text: userContent });
    }
    if (uploadedImages.length > 0) {
      for (const img of uploadedImages) {
        messageContent.push({
          type: 'image_url',
          image_url: { url: img.dataUrl }
        });
      }
      setUploadedImages([]);
    }

    const newUserMessages = [...chat.messages, { role: 'user', content: messageContent }];
    updateChat({ ...chat, messages: newUserMessages });

    setLoading(true);
    try {
      const result = await callApiForText({
        messages: newUserMessages,
        apiKey: settings.apiKey,
        model: settings.model
      });
      let finalMessages;
      if (result.error) {
        finalMessages = [...newUserMessages, { role: 'assistant', content: `Error: ${result.error}` }];
      } else {
        finalMessages = [...newUserMessages, { role: 'assistant', content: result.content || '' }];
      }
      updateChat({ ...chat, messages: finalMessages });
    } finally {
      setLoading(false);
    }

    // Clear form fields after sending
    if (mode === 'DEVELOP') {
      setFormData({
        ...formData,
        developGoal: '',
        developFeatures: '',
        developReturnFormat: '',
        developWarnings: '',
        developContext: '',
      });
      setHasEditedReturnFormat(false);
    } else if (mode === 'FIX') {
      setFormData({
        ...formData,
        fixCode: '',
        fixErrors: '',
      });
    }
    setDroppedFiles({});
    setConfirmRevert(false);
  }

  const currentChat = chats.find(c => c.id === currentChatId);
  const currentChatTokenCount = currentChat
    ? currentChat.messages.reduce((acc, msg) => {
        return acc + (typeof msg.content === 'string' ? approximateTokenCount(msg.content) : 0);
      }, 0)
    : 0;

  if (!currentChat) {
    return <h1 style={{ textAlign: 'center', marginTop: '20vh' }}>Loading Chat...</h1>;
  }

  return (
    <div className="app-container">
      {confirmRevert && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Confirm Revert</h3>
            <p>Click SEND again to revert the last message.</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setConfirmRevert(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {chatToDelete && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Delete Chat?</h3>
            <p>This will remove the chat and all messages. Are you sure?</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setChatToDelete(null)}>
                Cancel
              </button>
              <button className="button danger" onClick={confirmDeleteChat}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {messageToDelete && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Delete Message?</h3>
            <p>Are you sure you want to delete this message?</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setMessageToDelete(null)}>
                Cancel
              </button>
              <button className="button danger" onClick={confirmDeleteMessage}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onTitleUpdate={handleTitleUpdate}
        onDeleteChat={requestDeleteChat}
      />

      <div className="main-content">
        <div className="top-bar">
          <button
            className="button"
            onClick={() => setShowSettings(!showSettings)}
            style={{
              backgroundColor: '#000000',
              color: 'white',
              padding: 'var(--space-xs) var(--space-md)',
              borderRadius: 'var(--radius)',
              fontSize: '1em',
              fontWeight: 'normal'
            }}
          >
            {showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span className="ml-md" style={{ fontWeight: 'bold', marginLeft: 'var(--space-md)' }}>
            konzuko-code
          </span>
          <div
            className="token-usage"
            style={{
              marginLeft: 'var(--space-md)',
              backgroundColor: '#000000',
              color: 'white',
              padding: 'var(--space-xs) var(--space-md)',
              borderRadius: 'var(--radius)'
            }}
          >
            <span>Tokens Used in Current Chat: {currentChatTokenCount.toLocaleString()}</span>
          </div>
        </div>

        {showSettings && (
          <div
            style={{
              border: '1px solid var(--border)',
              margin: 'var(--space-md)',
              padding: 'var(--space-md)',
              borderRadius: 'var(--radius)'
            }}
          >
            <form onSubmit={handleSettingsSave}>
              <div className="form-group">
                <label className="form-label">OpenAI API Key:</label>
                <input
                  className="form-input"
                  type="text"
                  value={settings.apiKey}
                  onInput={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">OpenRouter API Key:</label>
                <input
                  className="form-input"
                  type="text"
                  value={settings.openRouterApiKey || ''}
                  onInput={(e) => setSettings({ ...settings, openRouterApiKey: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Model:</label>
                <select
                  className="form-select"
                  value={settings.model}
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                >
                  <option value="o3-mini-2025-01-31">o3-mini-2025-01-31 (default)</option>
                  <option value="o1">o1 (slower, more reasoning)</option>
                  <option value="o1-pro-2025-03-19">o1-pro-2025-03-19 (high-end reasoning)</option>
                  <option value="gpt-4o">gpt-4o (bigger model)</option>
                  <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27 (newest)</option>
                </select>
              </div>
              <button className="button" type="submit">
                Save
              </button>
            </form>
          </div>
        )}

        <div className="content-container">
          <div className="chat-container">
            {currentChat.messages.map((m, idx) => (
              <div key={idx} className={`message ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                <div className="message-header">
                  <div className="message-role">{m.role}</div>
                  <div className="message-actions">
                    <button
                      className="button icon-button"
                      onClick={() => navigator.clipboard.writeText(getMessagePlainText(m.content))}
                    >
                      Copy
                    </button>
                    {m.role === 'user' && (
                      <button
                        className="button icon-button"
                        onClick={() => handleResendMessage(idx)}
                        disabled={loading || idx < currentChat.messages.length - 1}
                        title={
                          idx < currentChat.messages.length - 1
                            ? "Can only resend the last message"
                            : "Resend this prompt"
                        }
                      >
                        Resend
                      </button>
                    )}
                    <button className="button icon-button" onClick={() => requestDeleteMessage(currentChat.id, idx)}>
                      Delete
                    </button>
                  </div>
                </div>
                <div className="message-content">{renderMessageContent(m.content)}</div>
                <div className="message-actions-bottom">
                  <button
                    className="button icon-button"
                    onClick={() => navigator.clipboard.writeText(getMessagePlainText(m.content))}
                  >
                    Copy
                  </button>
                  {m.role === 'user' && (
                    <button
                      className="button icon-button"
                      onClick={() => handleResendMessage(idx)}
                      disabled={loading || idx < currentChat.messages.length - 1}
                      title={
                        idx < currentChat.messages.length - 1
                          ? "Can only resend the last message"
                          : "Resend this prompt"
                      }
                    >
                      Resend
                    </button>
                  )}
                  <button className="button icon-button" onClick={() => requestDeleteMessage(currentChat.id, idx)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="template-container" onDragOver={handleTemplateDragOver} onDrop={handleTemplateDrop}>
            <div className="template-content">
              <div className="flex gap-sm mb-md">
                <button
                  className={`button ${mode === 'DEVELOP' ? 'active' : ''}`}
                  onClick={() => {
                    setMode('DEVELOP');
                    setConfirmRevert(false);
                  }}
                >
                  DEVELOP
                </button>
                <button
                  className={`button ${mode === 'FIX' ? 'active' : ''}`}
                  onClick={() => {
                    setMode('FIX');
                    setConfirmRevert(false);
                  }}
                >
                  FIX
                </button>
                <button className={`button ${mode === 'REVERT' ? 'active' : ''}`} onClick={() => setMode('REVERT')}>
                  REVERT
                </button>
              </div>

              <div className="template-grid">
                {mode === 'DEVELOP' && (
                  <div className="flex flex-column" style={{ overflow: 'auto' }}>
                    <div className="form-group">
                      <label className="form-label">GOAL:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        value={formData.developGoal}
                        onInput={(e) => setFormData({ ...formData, developGoal: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('developGoal', e)}
                      />
                      {droppedFiles.developGoal && droppedFiles.developGoal.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.developGoal.join(', ')}</small>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">List every FEATURE of the program:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        value={formData.developFeatures}
                        onInput={(e) => setFormData({ ...formData, developFeatures: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('developFeatures', e)}
                      />
                      {droppedFiles.developFeatures && droppedFiles.developFeatures.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.developFeatures.join(', ')}</small>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">RETURN FORMAT:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        placeholder="return complete refactored code in FULL so that i can paste it into my ide"
                        value={hasEditedReturnFormat ? formData.developReturnFormat : DEFAULT_RETURN_FORMAT}
                        onInput={(e) => {
                          setFormData({ ...formData, developReturnFormat: e.target.value });
                          setHasEditedReturnFormat(true);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('developReturnFormat', e)}
                      />
                      {droppedFiles.developReturnFormat && droppedFiles.developReturnFormat.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.developReturnFormat.join(', ')}</small>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">THINGS TO REMEMBER/WARNINGS:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        value={formData.developWarnings}
                        onInput={(e) => setFormData({ ...formData, developWarnings: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('developWarnings', e)}
                      />
                      {droppedFiles.developWarnings && droppedFiles.developWarnings.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.developWarnings.join(', ')}</small>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">CONTEXT:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        placeholder="(Optional) additional info"
                        value={formData.developContext}
                        onInput={(e) => setFormData({ ...formData, developContext: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('developContext', e)}
                      />
                      {droppedFiles.developContext && droppedFiles.developContext.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.developContext.join(', ')}</small>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {mode === 'FIX' && (
                  <div className="flex flex-column" style={{ overflow: 'auto' }}>
                    <div className="form-group">
                      <label className="form-label">FIX YOUR CODE:</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        value={formData.fixCode}
                        onInput={(e) => setFormData({ ...formData, fixCode: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('fixCode', e)}
                      />
                      {droppedFiles.fixCode && droppedFiles.fixCode.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.fixCode.join(', ')}</small>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">ANY ERRORS?</label>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        value={formData.fixErrors}
                        onInput={(e) => setFormData({ ...formData, fixErrors: e.target.value })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleTextareaDrop('fixErrors', e)}
                      />
                      {droppedFiles.fixErrors && droppedFiles.fixErrors.length > 0 && (
                        <div className="dropped-file-labels">
                          <small>Files added: {droppedFiles.fixErrors.join(', ')}</small>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {mode === 'REVERT' && (
                  <div className="mb-md">
                    {confirmRevert ? (
                      <div style={{ color: 'var(--error)' }}>
                        Are you sure? Clicking SEND again will revert the last message.
                      </div>
                    ) : (
                      <div>Click SEND to confirm revert. This will delete the last message from this chat.</div>
                    )}
                  </div>
                )}
              </div>

              {uploadedImages.length > 0 && (
                <div className="image-preview-container mb-md">
                  <div className="image-preview-header">
                    <span>Images to upload:</span>
                  </div>
                  <div className="image-preview-grid">
                    {uploadedImages.map((img, idx) => (
                      <div key={idx} className="image-preview-item">
                        <img src={img.dataUrl} alt={img.name} />
                        <button className="image-remove-button" onClick={() => removeUploadedImage(idx)}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Select or Drag/Drop Images:</label>
                <input
                  className="form-input"
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept="image/*"
                  onChange={handleFileSelection}
                />
              </div>
              <button className="button send-button mt-sm" onClick={handleSendPrompt} disabled={loading}>
                {loading ? <span className="loading-dots">Sending</span> : 'Send Prompt'}
              </button>
            </div>

            <div className="expand-handle" title="Resize template section">
              <div className="handle-line"></div>
              <span className="handle-text">Resize</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;