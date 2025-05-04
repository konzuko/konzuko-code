/* src/components/Toast.jsx */

import { useEffect } from 'preact/hooks';

// Copy same safeAlert logic
function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.error('Alert blocked in toast, fallback console:', msg, e);
  }
}

export default function Toast({
  text,
  onAction,        // optional async fn to undo / retry
  onClose,
  duration = 30000
}) {
  // auto-dismiss after <duration>
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [onClose, duration]);

  // wrap async action & catch errors with safeAlert
  const handleAction = () => {
    Promise.resolve(onAction?.())
      .catch(err => safeAlert(err.message || 'Unknown error'))
      .finally(onClose);
  };

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

      <button className="button icon-button" onClick={onClose}>✕</button>
    </div>
  );
}