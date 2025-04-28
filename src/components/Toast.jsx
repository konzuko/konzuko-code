import { useEffect } from 'preact/hooks'

export default function Toast({
  text,
  actionLabel = 'Undo',
  onAction,
  onClose,
  duration = 30_000, // auto‐dismiss after 30s
}) {
  // auto‐dismiss
  useEffect(() => {
    const id = setTimeout(onClose, duration)
    return () => clearTimeout(id)
  }, [onClose, duration])

  // wrap the action in a Promise so errors get caught
  const handleAction = () => {
    Promise.resolve(onAction?.())
      .catch(err => alert(err?.message ?? 'Undo failed'))
      .finally(onClose)
  }

  return (
    <div
      style={{
        position   : 'fixed',
        bottom     : 20,
        left       : '50%',
        transform  : 'translateX(-50%)',
        background : '#333',
        color      : '#fff',
        padding    : '10px 18px',
        borderRadius: 4,
        display    : 'flex',
        gap        : 12,
        zIndex     : 9999,
      }}
    >
      <span>{text}</span>
      {onAction && (
        <button className="button" onClick={handleAction}>
          {actionLabel}
        </button>
      )}
      <button className="button icon-button" onClick={onClose}>✕</button>
    </div>
  )
}