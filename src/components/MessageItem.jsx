/* ------------------------------------------------------------------
   MessageItem
   • Renders cached, pre-sanitised HTML (one-time Markdown → cached HTML)
   • If a row is missing .plainText / .checksum (older DB rows), we
     compute them on the fly once.
-------------------------------------------------------------------*/
import { memo }          from 'preact/compat';
import { getHtml }       from '../lib/htmlCache.js';
import { checksum32 }    from '../lib/checksum.js';

/* quick plain-text extractor – same rules as useMessages.js */
function toPlain(content) {
  if (Array.isArray(content)) {
    return content
      .map(b => (b.type === 'text' ? b.text : '[non-text]'))
      .join('');
  }
  return String(content ?? '');
}

function ensureFields(m) {
  if (!m.plainText)  m.plainText = toPlain(m.content);
  if (m.checksum == null) m.checksum  = checksum32(m.plainText);
}

/* --------------------------------------------------------------- */
function MessageItem({ m }) {
  ensureFields(m);
  const html = getHtml(m.checksum, m.plainText);

  return (
    <div
      className="message-content-inner"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(MessageItem, (a, b) => a.m.checksum === b.m.checksum);
