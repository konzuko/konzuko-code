// src/components/ConfirmationModal.jsx
import { useState, useEffect, useRef } from 'preact/hooks';

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmationText,
  confirmButtonText = 'Confirm'
}) {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef(null);
  const isMatch = inputText.toLowerCase() === confirmationText.toLowerCase();

  useEffect(() => {
    if (isOpen) {
      setInputText(''); // Reset on open
      // Focus the input shortly after the modal is rendered
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (isMatch) {
      onConfirm();
      onClose();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">
          {children}
          <div className="modal-confirmation-prompt">
            To proceed, please type "<strong>{confirmationText}</strong>" below:
          </div>
          <input
            ref={inputRef}
            type="text"
            className="form-input"
            value={inputText}
            onInput={e => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Type "${confirmationText}"`}
          />
        </div>
        <div className="modal-actions">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button"
            onClick={handleConfirm}
            disabled={!isMatch}
            style={isMatch ? { backgroundColor: 'var(--error)', color: '#fff' } : {}}
          >
            {confirmButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}
