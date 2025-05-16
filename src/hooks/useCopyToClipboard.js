// src/hooks/useCopyToClipboard.js
import { useState, useRef, useEffect } from 'preact/hooks';
import copyToClipboard                  from '../lib/copy.js';
import Toast                            from '../components/Toast.jsx';

/**
 * useCopyToClipboard()
 * Returns [copyFn, copiedBool]
 *
 * copyFn(text) copies the text and shows a Toast on success / failure.
 * `copiedBool` is true for `successMs` ms after a successful copy.
 */
export default function useCopyToClipboard({
  successMsg = 'Copied!',
  errorMsg   = 'Copy failed',
  successMs  = 1500,
  errorMs    = 2000
} = {}) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(0);

  /* cleanup on unmount */
  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function copy(text = '') {
    const ok = await copyToClipboard(text);

    if (ok) {
      setCopied(true);
      Toast(successMsg, successMs);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), successMs);
    } else {
      Toast(errorMsg, errorMs);
    }
    return ok;
  }

  return [copy, copied];
}
