import { useEffect } from 'preact/hooks';

// safeAlert for blocked popups
function safeAlert(msg) {
  try {
    alert(msg);
  } catch (e) {
    console.error('Alert blocked in toast, fallback console error:', msg, e);
  }
}

export default function Toast({
  text,
  onAction,       // optional async fn to undo or retry
  onClose,
  duration = 30000
}) {
  // Auto-dismiss after <duration> ms
  useEffect(() => {
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [onClose, duration]);

  // wrap the undo or retry in a try/catch w/ safeAlert
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
