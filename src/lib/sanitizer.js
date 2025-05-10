import createDOMPurify from 'isomorphic-dompurify';

/*
  We lazily create a global DOMPurify instance (stored on window),
  so it persists across HMR reloads without re-adding hooks every time.
*/
function getPurifier() {
  // SSR – no DOM available
  if (typeof window === 'undefined') return null;

  if (window.__konzukoPurifier) {
    return window.__konzukoPurifier;
  }

  const purify = createDOMPurify(window);
  // Force all anchor tags to open in new tabs, no referrer
  purify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer');
    }
  });

  window.__konzukoPurifier = purify;
  return purify;
}

/*
  If DOMPurify is unavailable (SSR), we just return the raw string
  so that hydration doesn't mismatch. The client will sanitize again once mounted.
*/
export function sanitize(html = '') {
  const p = getPurifier();
  if (!p) return html;
  return p.sanitize(html);
}