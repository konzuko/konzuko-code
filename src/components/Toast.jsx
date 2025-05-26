/*
  Toast   – stackable, HMR-safe, auto-cleaning

  Default call:
      import Toast from './components/Toast.jsx'
      Toast('Saved')                     // 4-second auto-dismiss
      Toast('Deleted', 6000, undoFn)     // shows “Undo” button

  • Each call appends a new toast <div> to a single fixed root.
  • Root is removed when the last toast disappears (prevents orphan
    elements across SPA navigations).
  • HMR cleanup removes any stray root on module reload.
  • Exports { showToast } alias for named-import style.
*/

import { h, render } from 'preact';

/* ────────── root management ────────── */
let rootEl = null;
function ensureRoot() {
  if (rootEl) return rootEl;

  rootEl = document.createElement('div');
  Object.assign(rootEl.style, {
    position   : 'fixed',
    bottom     : '20px',
    left       : '90%', 
    transform  : 'translateX(-50%)', 
    display    : 'flex',
    flexDirection: 'column',
    alignItems : 'center', // Center toasts horizontally if they don't take full width
    gap        : '8px',
    zIndex     : 9999
  });
  document.body.appendChild(rootEl);
  return rootEl;
}

/* HMR: wipe root on module dispose to avoid dupes */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rootEl?.remove();
    rootEl = null;
  });
}

/* ────────── main helper ────────── */
export default function Toast(msg, ms = 4000, onAction, actionText = "Undo") {
  const host = ensureRoot();

  /* individual mount node */
  const mount = document.createElement('div');
  host.appendChild(mount);

  /* disposer / clear fn */
  function clear() {
    render(null, mount);
    if (mount.parentNode) host.removeChild(mount);

    /* delete root if no more children */
    if (!host.childElementCount) {
      host.remove();
      rootEl = null;
    }
  }

  function handleUndo() {
    try { onAction?.(); } finally { clear(); }
  }

  /* toast vnode */
  const vnode = (
    <div
      role="status" aria-live="polite"
      style={{
        background   : '#333',
        color        : '#fff',
        padding      : '10px 16px', // Slightly more padding for multi-line
        borderRadius : 4,
        display      : 'flex',    // Changed to flex for better internal layout
        flexDirection: 'column',  // Stack message and button vertically
        gap          : '8px',     // Gap between message and button
        alignItems   : 'flex-start', // Align content to the start (left)
        fontSize     : '0.9rem',
        boxShadow    : '0 2px 8px rgba(0,0,0,0.5)', // Slightly stronger shadow
        maxWidth     : '450px',     // Max width for readability
        width        : 'auto',      // Allow it to shrink if content is narrow
        textAlign    : 'left',      // Ensure text is left-aligned
      }}
    >
      <span style={{ whiteSpace: 'pre-line' }}>{msg}</span>
      {onAction && (
        <button
          onClick={handleUndo}
          style={{
            background   : '#555',
            border       : 'none',
            color        : '#fff',
            padding      : '6px 12px', // Slightly larger button
            borderRadius : 4,
            cursor       : 'pointer',
            minWidth     : '60px',
            alignSelf    : 'flex-end', // Align button to the right
            marginTop    : '4px',      // Margin if needed, gap might cover it
          }}
        >
          {actionText}
        </button>
      )}
    </div>
  );

  render(vnode, mount);

  /* auto-clear timer */
  const t = setTimeout(clear, ms);

  /* return disposer to caller (optional) */
  return () => { clearTimeout(t); clear(); };
}

/* named re-export for convenience */
export const showToast = Toast;
