
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
    left       : '50%',
    transform  : 'translateX(-50%)',
    display    : 'flex',
    flexDirection: 'column',
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
export default function Toast(msg, ms = 4000, onAction) {
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
        padding      : '8px 16px',
        borderRadius : 4,
        display      : 'inline-flex',
        gap          : 12,
        alignItems   : 'center',
        fontSize     : '0.9rem',
        boxShadow    : '0 2px 6px rgba(0,0,0,0.4)'
      }}
    >
      <span>{msg}</span>
      {onAction && (
        <button
          onClick={handleUndo}
          style={{
            background   : '#555',
            border       : 'none',
            color        : '#fff',
            padding      : '4px 10px',
            borderRadius : 4,
            cursor       : 'pointer',
            minWidth     : '48px'  /* avoid width jump */
          }}
        >
          Undo
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

