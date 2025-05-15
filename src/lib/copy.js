/* ------------------------------------------------------------------
   copyToClipboard(text) – async, returns true on success.
   1) Tries modern navigator.clipboard
   2) Falls back to execCommand('copy') with a hidden <textarea>
-------------------------------------------------------------------*/
export async function copyToClipboard(text = '') {
    /* A) modern API */
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  
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
    } catch {
      return false;
    }
  }
  
  /* optional default export */
  export default copyToClipboard;
