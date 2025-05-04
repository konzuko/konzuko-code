/*
   Updated so if the undo fails we don’t close the toast immediately.
   The user sees the error from safeAlert and can possibly retry.
*/

import { useEffect, useState } from 'preact/hooks';

function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.error('Alert blocked in toast, fallback console error:', msg, e);
  }
}

export default function Toast({
  text,
  onAction,   // async fn for “Undo” or retry
  onClose,
  duration = 30000
}) {
  const [dismissed, setDismissed] = useState(false);

  // Auto‐dismiss after <duration> if user doesn’t click “Undo”
  useEffect(() => {
    const id = setTimeout(() => {
      setDismissed(true);
      onClose();
    }, duration);
    return () => clearTimeout(id);
  }, [onClose, duration]);

  // We only close after a successful undo action
  const handleAction = async () => {
    if (!onAction) {
      // if no action, just close
      onClose();
      return;
    }
    try {
      await onAction();
      onClose();
    } catch (err) {
      // show error, but keep toast open
      safeAlert(err.message || 'Unknown error');
      console.error('Undo failed:', err);
    }
  };

  if (dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom:   20,
        left:     '50%',
        transform:'translateX(-50%)',
        background:  '#333',
        color:       '#fff',
        padding:     '10px 18px',
        borderRadius: 4,
        display:     'flex',
        gap:         12,
        zIndex:      9999
      }}
    >
      <span>{text}</span>

      {onAction && (
        <button className="button" onClick={handleAction}>
          Undo
        </button>
      )}

      <button className="button icon-button" onClick={() => { setDismissed(true); onClose(); }}>
        ✕
      </button>
    </div>
  );
}
