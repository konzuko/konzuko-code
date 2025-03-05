import { useState, useEffect, useRef } from 'preact/hooks';
import ChatPane from './chatpane.jsx';
import { callApiForText, callApiForImageDescription } from './api.js';
import { useChats, useSettings } from './hooks.js';

function App() {
  const {
    chats,
    addChat,
    updateChat,
    totalTokens,
    handleMemoryManagement,
    isMemoryLimitExceeded,
  } = useChats();

  const [settings, setSettings] = useSettings();
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState('DEVELOP');
  const [formData, setFormData] = useState({
    developGoal: '',
    developFeatures: '',
    developReturnFormat: '',
    developWarnings: '',
    developContext: '',
    fixCode: '',
    fixErrors: '',
  });
  const [confirmRevert, setConfirmRevert] = useState(false);
  const fileInputRef = useRef();
  const [loading, setLoading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [imageDescriptionLoading, setImageDescriptionLoading] = useState(false);

  // Ensure at least one chat is available
  useEffect(() => {
    if (chats.length === 0) {
      handleNewChat();
    } else if (currentChatId === null && chats.length > 0) {
      setCurrentChatId(chats[0].id);
    }
  }, [chats]);

  // Auto trigger memory management if token limit is exceeded
  useEffect(() => {
    if (isMemoryLimitExceeded && currentChatId) {
      handleMemoryRestriction();
    }
  }, [isMemoryLimitExceeded, currentChatId]);

  async function handleMemoryRestriction() {
    if (!settings.apiKey || !currentChatId) return;
    setLoading(true);
    try {
      // Show notification to the user
      const chat = chats.find(c => c.id === currentChatId);
      if (chat) {
        chat.messages.push({
          role: 'system',
          content: 'Memory limit reached (50,000 tokens). Creating a new chat with a summary of this conversation...',
          timestamp: Date.now()
        });
        updateChat({ ...chat });
      }
      
      // Wait a moment for the user to see the notification
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const newChatId = await handleMemoryManagement(currentChatId, settings.apiKey);
      if (newChatId) {
        setCurrentChatId(newChatId);
      }
    } catch (error) {
      console.error('Error in memory management:', error);
      
      // Show error notification
      const chat = chats.find(c => c.id === currentChatId);
      if (chat) {
        chat.messages.push({
          role: 'system',
          content: `Error creating summary: ${error.message}. Please try again or manually create a new chat.`,
          timestamp: Date.now()
        });
        updateChat({ ...chat });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleNewChat() {
    const newChat = {
      id: Date.now() + '-' + Math.random().toString(36).substring(2, 9),
      title: 'New Chat',
      started: new Date().toISOString(),
      messages: [
        {
          role: 'assistant',
          content: 'Hello! Welcome to Konzuko Code. How may I assist you today?',
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

  async function handleSendPrompt() {
    if (!currentChatId) return;
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;

    let imagesDescription = '';
    const files = fileInputRef.current?.files;
    if (files && files.length > 0) {
      const urls = [];
      for (let i = 0; i < files.length; i++) {
        const url = URL.createObjectURL(files[i]);
        urls.push(url);
      }
      setLoading(true);
      const descRes = await callApiForImageDescription({
        imageUrls: urls,
        apiKey: settings.apiKey,
        model: settings.model,
      });
      setLoading(false);
      if (!descRes.error && descRes.content) {
        imagesDescription = '\\n[ IMAGES DESCRIBED AS ]:\\n' + descRes.content;
      }
      fileInputRef.current.value = '';
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
${imagesDescription ? imagesDescription : ''}
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
${imagesDescription ? imagesDescription : ''}
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

    // Add the user's message to the chat
    chat.messages.push({
      role: 'user',
      content: userContent,
    });
    updateChat({ ...chat });
    setLoading(true);
    const result = await callApiForText({
      messages: chat.messages,
      apiKey: settings.apiKey,
      model: settings.model,
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
    
    // Check if memory limit is exceeded and handle it
    if (isMemoryLimitExceeded) {
      await handleMemoryRestriction();
    }
    
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

  function handleCopyContent(text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function handleDeleteMessage(index) {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;
    chat.messages.splice(index, 1);
    updateChat({ ...chat });
  }
  
  // Delete confirmation handling
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState(null);
  
  function confirmDelete(index) {
    setDeleteConfirmIndex(index);
  }
  
  function handleConfirmDelete() {
    if (deleteConfirmIndex !== null) {
      handleDeleteMessage(deleteConfirmIndex);
      setDeleteConfirmIndex(null);
    }
  }
  
  function cancelDelete() {
    setDeleteConfirmIndex(null);
  }
  
  // Image handling functions
  function handleImageUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const newImages = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      
      const imageUrl = URL.createObjectURL(file);
      newImages.push({
        url: imageUrl,
        name: file.name,
        size: file.size
      });
    }
    
    setUploadedImages([...uploadedImages, ...newImages]);
  }
  
  function removeImage(index) {
    const newImages = [...uploadedImages];
    URL.revokeObjectURL(newImages[index].url); // Clean up object URL
    newImages.splice(index, 1);
    setUploadedImages(newImages);
  }
  
  async function getImageDescriptions() {
    if (uploadedImages.length === 0 || !settings.apiKey) return;
    
    setImageDescriptionLoading(true);
    try {
      const imageUrls = uploadedImages.map(img => img.url);
      const result = await callApiForImageDescription({
        imageUrls,
        apiKey: settings.apiKey,
        model: settings.model
      });
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      // Add the description to the chat
      const chat = chats.find(c => c.id === currentChatId);
      if (!chat) return;
      
      chat.messages.push({
        role: 'system',
        content: `Image Analysis:\n\n${result.content}`,
        timestamp: Date.now()
      });
      
      updateChat({ ...chat });
      setUploadedImages([]);
    } catch (error) {
      console.error('Error getting image descriptions:', error);
      
      // Show error in chat
      const chat = chats.find(c => c.id === currentChatId);
      if (chat) {
        chat.messages.push({
          role: 'system',
          content: `Error analyzing images: ${error.message}`,
          timestamp: Date.now()
        });
        updateChat({ ...chat });
      }
    } finally {
      setImageDescriptionLoading(false);
    }
  }
  
  // Handle form submission for the chat input
  const [userInput, setUserInput] = useState('');
  
  function handleSubmit(e) {
    e.preventDefault();
    if (!userInput.trim()) return;
    
    // Add user message to chat
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat) return;
    
    chat.messages.push({
      role: 'user',
      content: userInput
    });
    
    updateChat({ ...chat });
    setUserInput('');
  }
  
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const currentChat = chats.find(c => c.id === currentChatId);
  if (!currentChat) {
    return <h1 style={{ textAlign: 'center', marginTop: '20vh' }}>Loading Chat...</h1>;
  }

return (
  <div className="app-container">
      {/* Delete Confirmation Dialog */}
      {deleteConfirmIndex !== null && (
        <div className="modal-overlay">
          <div className="confirm-dialog">
            <h3>Confirm Delete</h3>
            <p>Are you sure you want to delete this message?</p>
            <div className="dialog-buttons">
              <button className="button" onClick={cancelDelete}>Cancel</button>
              <button className="button danger" onClick={handleConfirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Left Chat Pane */}
      <ChatPane
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
      />
      {/* Main Chat Area */}
      <div className="main-content">
        {/* Top bar with settings */}
        <div className="top-bar">
          <button className="button" onClick={() => setShowSettings(!showSettings)}>
            {showSettings ? 'Close Settings' : 'Open Settings'}
          </button>
          <span className="ml-md" style={{ fontWeight: 'bold', marginLeft: 'var(--space-md)' }}>konzuko-code</span>
          <div className="token-usage">
            <span className={isMemoryLimitExceeded ? 'token-limit-exceeded' : ''}>
              Tokens: {totalTokens.toLocaleString()} / 50,000
              {isMemoryLimitExceeded && ' (limit reached)'}
            </span>
          </div>
        </div>
        {/* Settings Panel */}
        {showSettings && (
          <div style={{ border: '1px solid var(--border)', margin: 'var(--space-md)', padding: 'var(--space-md)', borderRadius: 'var(--radius)' }}>
            <form onSubmit={handleSettingsSave}>
              <div className="form-group">
                <label className="form-label">API Key:</label>
                <input
                  className="form-input"
                  type="text"
                  value={settings.apiKey}
                  onInput={(e) => setSettings({ ...settings, apiKey: e.target.value })}
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
                </select>
              </div>
              <button className="button" type="submit">Save</button>
            </form>
          </div>
        )}
        {/* Main content with 50/50 split */}
        <div className="content-container">
          {/* Chat Messages - 50% */}
          <div className="chat-container">
            {currentChat.messages.map((m, idx) => (
              <div key={idx} className={`message ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                <div className="message-header">
                  <div className="message-role">{m.role}</div>
                  <div className="message-actions">
                    <button className="button icon-button" onClick={() => handleCopyContent(m.content)}>Copy</button>
                    <button 
                      className="button icon-button" 
                      onClick={() => confirmDelete(idx)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="message-content">{m.content}</div>
                {m.role === 'system' && m.content.includes('Memory limit reached') && (
                  <div className="memory-limit-alert">
                    Memory limit reached. A new chat was created with a summary.
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* Template Section - 50% */}
          <div className="template-container">
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
                />
              </div>
              <div className="form-group">
                <label className="form-label">List every FEATURE of the program:</label>
                <textarea 
                  className="form-textarea" 
                  rows={2} 
                  value={formData.developFeatures} 
                  onInput={(e) => setFormData({ ...formData, developFeatures: e.target.value })} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">RETURN FORMAT:</label>
                <textarea 
                  className="form-textarea" 
                  rows={2} 
                  placeholder="(Optional) e.g. JSON, etc." 
                  value={formData.developReturnFormat} 
                  onInput={(e) => setFormData({ ...formData, developReturnFormat: e.target.value })} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">THINGS TO REMEMBER/WARNINGS:</label>
                <textarea 
                  className="form-textarea" 
                  rows={2} 
                  value={formData.developWarnings} 
                  onInput={(e) => setFormData({ ...formData, developWarnings: e.target.value })} 
                />
              </div>
              <div className="form-group">
                <label className="form-label">CONTEXT:</label>
                <textarea 
                  className="form-textarea" 
                  rows={2} 
                  placeholder="(Optional) additional info" 
                  value={formData.developContext} 
                  onInput={(e) => setFormData({ ...formData, developContext: e.target.value })} 
                />
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
                />
              </div>
              <div className="form-group">
                <label className="form-label">ANY ERRORS?</label>
                <textarea 
                  className="form-textarea" 
                  rows={2} 
                  value={formData.fixErrors} 
                  onInput={(e) => setFormData({ ...formData, fixErrors: e.target.value })} 
                />
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
              
              <div className="form-group">
                <label className="form-label">Drag/Drop Images:</label>
                <input className="form-input" type="file" ref={fileInputRef} multiple accept="image/*" />
              </div>
              <button className="button mt-sm" onClick={handleSendPrompt}>
                {mode === 'REVERT' ? 'SEND' : 'Send Prompt'}
              </button>
              {loading && (
                <div className="loading">
                  <div className="loading-dots">
                    <div className="dot"></div>
                    <div className="dot"></div>
                    <div className="dot"></div>
                  </div>
                  <span>Loading...</span>
                </div>
              )}
            </div>
            <div className="expand-handle" title="Resize template section">
              <div className="handle-line"></div>
              <span className="handle-text">Resize</span>
            </div>
          </div>
        </div>
        
        {/* Input container at the bottom */}
        <div className="input-container">
          {/* Image upload preview */}
          {uploadedImages.length > 0 && (
            <div className="image-preview-container">
              <div className="image-preview-header">
                <h4>Uploaded Images ({uploadedImages.length})</h4>
                <button 
                  className="button" 
                  onClick={getImageDescriptions} 
                  disabled={imageDescriptionLoading}
                >
                  {imageDescriptionLoading ? 'Analyzing...' : 'Analyze Images'}
                </button>
              </div>
              <div className="image-preview-grid">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="image-preview-item">
                    <img src={img.url} alt={img.name} />
                    <button 
                      className="image-remove-button" 
                      onClick={() => removeImage(index)}
                      title="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <textarea
                className="form-textarea"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter your message..."
                rows="3"
              />
            </div>
            <div className="input-actions">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageUpload}
                accept="image/*"
                multiple
                style={{ display: 'none' }}
              />
              <button 
                type="button" 
                className="button icon-button" 
                onClick={() => fileInputRef.current?.click()}
                title="Upload images"
              >
                📷
              </button>
              <button type="submit" className="button" disabled={loading}>
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
