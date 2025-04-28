export default function Toast ({ text, actionLabel, onAction, onClose }) {
    return (
      <div
        style={{
          position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
          background:'#333', color:'#fff',
          padding:'10px 18px', borderRadius:4,
          display:'flex', gap:12, zIndex:9999
        }}
      >
        <span>{text}</span>
        {actionLabel && <button className="button" onClick={onAction}>{actionLabel}</button>}
        <button className="button icon-button" onClick={onClose}>✕</button>
      </div>
    )
  }