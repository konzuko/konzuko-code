
import { render } from 'preact'

let hostEl = null

function ensureRoot() {
  if (hostEl) return hostEl
  hostEl = document.createElement('div')
  hostEl.style.position = 'fixed'
  hostEl.style.bottom = '20px'
  hostEl.style.left = '50%'
  hostEl.style.transform = 'translateX(-50%)'
  hostEl.style.zIndex = 9999
  document.body.appendChild(hostEl)
  return hostEl
}

/**
 * Displays a toast message for ms milliseconds (defaults to 4000).
 * 
 * Usage:
 *   import Toast from './Toast.jsx'
 *   Toast('Hello from my app!', 3000)
 */
export default function Toast(msg, ms = 4000) {
  const root = ensureRoot()
  
  // Render the toast DOM
  render(
    <div
      style={{
        background: '#333',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: 4
      }}
    >
      {msg}
    </div>,
    root
  )

  // Automatically clear the toast after the specified time
  setTimeout(() => {
    render(null, root)
  }, ms)
}
