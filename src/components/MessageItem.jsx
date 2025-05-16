/* ------------------------------------------------------------------
   MessageItem – markdown renderer with fast memo
-------------------------------------------------------------------*/
import { memo }          from 'preact/compat';
import MarkdownRenderer  from './MarkdownRenderer.jsx';
import { checksum32 }    from '../lib/checksum.js';

/* helpers */
function flatten(content) {
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return String(content ?? '');
}

/* ensure we have a checksum on the message object */
function ensureChecksum(m) {
  if (m.checksum == null) {
    m.checksum = checksum32(flatten(m.content));
  }
}

function MessageItem({ m }) {
  ensureChecksum(m);
  const text = flatten(m.content);

  return (
    <div className="message-content-inner">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  );
}

export default memo(
  MessageItem,
  (a, b) => a.m.id === b.m.id && a.m.checksum === b.m.checksum
);