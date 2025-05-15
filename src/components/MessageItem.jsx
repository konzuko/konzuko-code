/* ------------------------------------------------------------------
   MessageItem – cached Markdown → HTML renderer
   • Still adds inline “Copy” buttons to each <pre>, but now uses the
     shared copyToClipboard() helper for robust fallback support.
-------------------------------------------------------------------*/
import { memo }        from 'preact/compat';
import { useRef, useEffect } from 'preact/hooks';
import { getHtml }     from '../lib/htmlCache.js';
import { checksum32 }  from '../lib/checksum.js';
import Toast           from './Toast.jsx';
import { copyToClipboard } from '../lib/copy.js';

/* plain-text extractor (same rules as useMessages.js) */
function toPlain(content) {
  if (Array.isArray(content)) {
    return content
      .map(b => (b.type === 'text' ? b.text : '[non-text]'))
      .join('');
  }
  return String(content ?? '');
}

function ensureMeta(m) {
  if (!m.plainText)  m.plainText = toPlain(m.content);
  if (m.checksum == null) m.checksum = checksum32(m.plainText);
}

/* ---------------------------------------------------------------- */
function MessageItem({ m }) {
  ensureMeta(m);
  const html  = getHtml(m.checksum, m.plainText);
  const ref   = useRef(null);

  /* add “Copy” buttons to code blocks exactly once */
  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const pres = host.querySelectorAll('pre');
    pres.forEach(pre => {
      if (pre.querySelector('.code-copy-btn')) return;    // already done

      pre.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = 'Copy';
      Object.assign(btn.style, {
        position   : 'absolute',
        top        : '4px',
        right      : '4px',
        padding    : '2px 8px',
        fontSize   : '0.75rem',
        background : '#444',
        color      : '#fff',
        border     : 'none',
        borderRadius: '4px',
        cursor     : 'pointer',
        opacity    : '0.8'
      });

      btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '0.8');

      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const ok = await copyToClipboard(pre.innerText);
        if (ok) {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        } else {
          Toast('Copy failed', 2000);
        }
      });

      pre.appendChild(btn);
    });

    /* cleanup on unmount (HMR safety) */
    return () => {
      pres.forEach(pre => {
        const b = pre.querySelector('.code-copy-btn');
        b && b.remove();
      });
    };
  }, []);

  return (
    <div
      ref={ref}
      className="message-content-inner"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(MessageItem, (a, b) => a.m.checksum === b.m.checksum);