// src/hooks/useCopyToClipboard.js
import { useState, useRef, useEffect } from 'preact/hooks';
import copyToClipboard                  from '../lib/copy.js';
import Toast                            from '../components/Toast.jsx';

/**
 * useCopyToClipboard()
 *   const [copy, copied] = useCopyToClipboard(opts?)
 *
 * Options:
 *   successMsg : text for success toast          (default 'Copied!')
 *   errorMsg   : text for generic failure toast  (default 'Copy failed')
 *   successMs  : toast duration on success       (default 1500)
 *   errorMs    : toast duration on failure       (default 2000)
 *   toast      : show success toast?             (default false)
 *
 * Behaviour:
 *   • `copied` flag toggles TRUE for `successMs`, regardless of toast flag.
 *   • Permission errors always surface a toast so the user knows why it failed.
 */
export default function useCopyToClipboard({
  successMsg = 'Copied!',
  errorMsg   = 'Copy failed',
  successMs  = 1500,
  errorMs    = 2000,
  toast      = false
} = {}) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(0);

  /* cleanup on unmount */
  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function copy(text = '') {
    let ok = false;

    try {
      ok = await copyToClipboard(text);
    } catch (err) {
      // Clipboard permission denied (NotAllowedError) or other fatal error
      Toast(
        err?.name === 'NotAllowedError'
          ? 'Clipboard blocked by browser permissions'
          : errorMsg,
        errorMs
      );
      return false;
    }

    if (ok) {
      // visual feedback (button label) – always
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), successMs);

      // optional toast
      if (toast) Toast(successMsg, successMs);
    } else {
      // copy failed silently (legacy path) – generic error toast
      Toast(errorMsg, errorMs);
    }

    return ok;
  }

  return [copy, copied];
}
