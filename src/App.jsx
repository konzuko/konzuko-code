/* App.jsx */
import { useState, useEffect, useRef } from 'preact/hooks';
import ChatPane from './chatpane.jsx';
import { callApiForText, callApiForImageDescription } from './api.js';
import { useChats, useSettings, useFormData, useDroppedFiles, useMode, approximateTokenCount } from './hooks.js';

/**
 * Helper function to read a File as a base64 data URL
 */
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(evt.target.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

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
    if (file.type.startsWith("text/")) return true;
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
          setFormData(prev => ({
            ...prev,
            [fieldName]: prev[fieldName] + "\n/* Content from " + file.name + " */\n" + textContent
          }));
          setDroppedFiles(prev => ({
            ...prev,
            [fieldName]: [...(prev[fieldName] || []), file.name]
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

  // ─── Chat Title Handlers (now just manual) ─────────────────────────────
  function handleTitleUpdate(chatId, newTitle) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.title = newTitle;
    updateChat({ ...chat });
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
        },
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
      chat.messages.splice(messageToDelete.messageIndex, 1);
      updateChat({ ...chat });
    }
    setMessageToDelete(null);
  }
  
  async function handleResendMessage(messageIndex) {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || messageIndex >= chat.messages.length) return;
    
    // Only resend user messages
    if (chat.messages[messageIndex].role !== 'user') return;
    
    // Check if there are messages after this one
    if (messageIndex < chat.messages.length - 1) return;
    
    // Get the user message content - we don't need to add it again since we're reusing it
    const userContent = chat.messages[messageIndex].content;
    
    // Send to API - use all messages up to and including this one
    setLoading(true);
    const result = await callApiForText({
      messages: chat.messages.slice(0, messageIndex + 1),
      apiKey: settings.apiKey,
      model: settings.model
    });
    setLoading(false);
    
    if (result.error) {
      chat.messages.push({
        role: 'assistant',
        content: `Error: ${result.error}`,
      });
    } else {
      chat.messages.push({
        role: 'assistant',
        content: result.content || '',
      });
    }
    updateChat({ ...chat });
  }

  function confirmDeleteChat() {
    if (!chatToDelete) return;
    deleteChat(chatToDelete);
    setChatToDelete(null);
    if (currentChatId === chatToDelete && chats.length > 1) {
      // After deleting, set currentChatId to the first remaining chat, if any
      const remainingChats = chats.filter(c => c.id !== chatToDelete);
      if (remainingChats.length > 0) {
        setCurrentChatId(remainingChats[0].id);
      } else {
        setCurrentChatId(null);
      }
    } else if (chats.length === 1) {
      // If we just deleted the last chat, create a new one
      handleNewChat();
    }
  }

  // ─── Prompt Sending Function ─────────────────────────────
  async function handleSendPrompt() {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    let imagesDescription = '';
    if (uploadedImages.length > 0) {
      const dataUrls = uploadedImages.map(img => img.dataUrl);
      setLoading(true);
      const descRes = await callApiForImageDescription({
        imageUrls: dataUrls,
        apiKey: settings.apiKey,
        openRouterApiKey: settings.openRouterApiKey
        // model defaults to mistralai/mistral-small-24b-instruct-2501
      });
      setLoading(false);
      if (!descRes.error && descRes.content) {
        imagesDescription = '\n[ IMAGES DESCRIBED AS ]:\n' + descRes.content;
      } else {
        imagesDescription = '\n[ IMAGES DESCRIBED AS ]: Error describing images: ' + (descRes.error || 'unknown error');
      }
      setUploadedImages([]);
    }

    let userContent = '';
    if (mode === 'DEVELOP') {
      const isFirstMessage = chat.messages.length === 0;
      userContent = `
MODE: DEVELOP
GOAL: ${formData.developGoal}
FEATURES: ${formData.developFeatures}
RETURN FORMAT: ${formData.developReturnFormat}
THINGS TO REMEMBER/WARNINGS: ${formData.developWarnings}
CONTEXT: ${formData.developContext}
${imagesDescription}
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
${imagesDescription}
      `.trim();
    } else if (mode === 'REVERT') {
      if (!confirmRevert) {
        setConfirmRevert(true);
        return;
      } else {
        if (chat.messages.length > 0) {
          chat.messages.pop();
          updateChat({ ...chat });
        }
        setConfirmRevert(false);
        return;
      }
    }
    if (!userContent.trim()) return;

    chat.messages.push({
      role: 'user',
      content: userContent,
    });
    updateChat({ ...chat });
    setLoading(true);
    const result = await callApiForText({
      messages: chat.messages,
      apiKey: settings.apiKey,
      model: settings.model
    });
    setLoading(false);
    if (result.error) {
      chat.messages.push({
        role: 'assistant',
        content: `Error: ${result.error}`,
      });
    } else {
      chat.messages.push({
        role: 'assistant',
        content: result.content || '',
      });
    }
    updateChat({ ...chat });

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
    } else if (mode === 'FIX') {
      setFormData({
        ...formData,
        fixCode: '',
        fixErrors: '',
      });
    }
    setConfirmRevert(false);
  }

  const currentChat = chats.find(c => c.id === currentChatId);

  // Compute token count for the current chat.
  const currentChatTokenCount = currentChat ? currentChat.messages.reduce((acc, msg) => {
    return acc + (typeof msg.content === 'string' ? approximateTokenCount(msg.content) : 0);
  }, 0) : 0;

  if (!currentChat) {
    return <h1 style={{ textAlign: 'center', marginTop: '20vh' }}>Loading Chat...</h1>;
  }

  return (
    <div className="app-container">
      {/* Confirm revert last message */}
      {confirmRevert && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Confirm Revert</h3>
            <p>Click SEND again to revert the last message.</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setConfirmRevert(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete chat */}
      {chatToDelete && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Delete Chat?</h3>
            <p>This will remove the chat and all messages. Are you sure?</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setChatToDelete(null)}>Cancel</button>
              <button className="button danger" onClick={confirmDeleteChat}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete message */}
      {messageToDelete && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Delete Message?</h3>
            <p>Are you sure you want to delete this message?</p>
            <div className="dialog-buttons">
              <button className="button" onClick={() => setMessageToDelete(null)}>Cancel</button>
              <button className="button danger" onClick={confirmDeleteMessage}>Delete</button>
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
          <button className="button" onClick={() => setShowSettings(!showSettings)} style={{ backgroundColor: '#000000', color: 'white', padding: 'var(--space-xs) var(--space-md)', borderRadius: 'var(--radius)', fontSize: '1em', fontWeight: 'normal' }}>
            {showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span className="ml-md" style={{ fontWeight: 'bold', marginLeft: 'var(--space-md)' }}>konzuko-code</span>
          <div className="token-usage" style={{ marginLeft: 'var(--space-md)', backgroundColor: '#000000', color: 'white', padding: 'var(--space-xs) var(--space-md)', borderRadius: 'var(--radius)' }}>
            <span>
              Tokens Used in Current Chat: {currentChatTokenCount.toLocaleString()}
            </span>
          </div>
        </div>
  
        {showSettings && (
          <div style={{ border: '1px solid var(--border)', margin: 'var(--space-md)', padding: 'var(--space-md)', borderRadius: 'var(--radius)' }}>
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
                  <option value="gpt-4o">gpt-4o (bigger model)</option>
                  <option value="gpt-4.5-preview-2025-02-27">gpt-4.5-preview-2025-02-27 (newest)</option>
                </select>
              </div>
              <button className="button" type="submit">Save</button>
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
                    <button className="button icon-button" onClick={() => navigator.clipboard.writeText(m.content)}>Copy</button>
                    {m.role === 'user' && (
                      <button 
                        className="button icon-button" 
                        onClick={() => handleResendMessage(idx)}
                        disabled={loading || idx < currentChat.messages.length - 1}
                        title={idx < currentChat.messages.length - 1 ? "Can only resend the last message" : "Resend this prompt"}
                      >
                        Resend
                      </button>
                    )}
                    <button 
                      className="button icon-button" 
                      onClick={() => requestDeleteMessage(currentChat.id, idx)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="message-content">{m.content}</div>
                <div className="message-actions-bottom">
                  <button className="button icon-button" onClick={() => navigator.clipboard.writeText(m.content)}>Copy</button>
                  {m.role === 'user' && (
                    <button 
                      className="button icon-button" 
                      onClick={() => handleResendMessage(idx)}
                      disabled={loading || idx < currentChat.messages.length - 1}
                      title={idx < currentChat.messages.length - 1 ? "Can only resend the last message" : "Resend this prompt"}
                    >
                      Resend
                    </button>
                  )}
                  <button 
                    className="button icon-button" 
                    onClick={() => requestDeleteMessage(currentChat.id, idx)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
  
          <div 
            className="template-container"
            onDragOver={handleTemplateDragOver}
            onDrop={handleTemplateDrop}
          >
            <div className="template-content">
              <div className="flex gap-sm mb-md">
                <button 
                  className={`button ${mode === 'DEVELOP' ? 'active' : ''}`} 
                  onClick={() => { setMode('DEVELOP'); setConfirmRevert(false); }}
                >
                  DEVELOP
                </button>
                <button 
                  className={`button ${mode === 'FIX' ? 'active' : ''}`} 
                  onClick={() => { setMode('FIX'); setConfirmRevert(false); }}
                >
                  FIX
                </button>
                <button 
                  className={`button ${mode === 'REVERT' ? 'active' : ''}`} 
                  onClick={() => { setMode('REVERT'); }}
                >
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
                        value={formData.developReturnFormat || "return complete refactored code in FULL so that i can paste it into my ide"} 
                        onInput={(e) => setFormData({ ...formData, developReturnFormat: e.target.value })} 
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
                    {confirmRevert
                      ? <div style={{ color: 'var(--error)' }}>Are you sure? Clicking SEND again will revert the last message.</div>
                      : <div>Click SEND to confirm revert. This will delete the last message from this chat.</div>}
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
                        <button 
                          className="image-remove-button" 
                          onClick={() => removeUploadedImage(idx)}
                        >
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