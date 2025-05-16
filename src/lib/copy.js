/* ------------------------------------------------------------------
   copyToClipboard(text) – async, returns true on success.
   Behaviour update:
   • If the modern Clipboard API throws `NotAllowedError`, we re-throw it
     so callers (hooks/useCopyToClipboard) can show a specific message.
-------------------------------------------------------------------*/
export async function copyToClipboard(text = '') {
    /* A) modern API */
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // Explicitly surface permission errors
        if (err?.name === 'NotAllowedError') throw err;
        /* any other failure falls through to legacy path */
      }
    }
  
    /* B) legacy fallback */
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw err;
      return false;
    }
  }
  
  /* optional default export */
  export default copyToClipboard;
  