// src/components/MessageItem.jsx
/* ------------------------------------------------------------------
   MessageItem – markdown renderer with WeakMap checksum memo
-------------------------------------------------------------------*/
import { memo }             from 'preact/compat';
import MarkdownRenderer     from './MarkdownRenderer.jsx';
import { getChecksum }      from '../lib/checksumCache.js';

/* flatten helper (text-only) */
function flatten(content) {
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return String(content ?? '');
}

function MessageItem({ m }) {
  const text = flatten(m.content);

  return (
    <div className="message-content-inner">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  );
}

/* O(1) WeakMap checksum compare */
export default memo(
  MessageItem,
  (a, b) => a.m.id === b.m.id && getChecksum(a.m) === getChecksum(b.m)
);
