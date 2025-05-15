// Re‐export the Toast component as a named export `toast()`
import Toast from '../components/Toast.jsx'

/**
 * toast(msg, ms?)
 * Named export for programmatic use (e.g. from hooks)
 *
 * Usage in non‐JSX modules:
 *   import { toast } from '../lib/toast.js'
 *   toast('Something happened!', 5000)
 */
export function toast(msg, ms = 4000) {
  Toast(msg, ms)
}

// Optional default export too, if you ever want:
//    import toast from '../lib/toast.js'
export default toast