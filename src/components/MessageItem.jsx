// src/components/MessageItem.jsx
/* ------------------------------------------------------------------
   MessageItem – renders markdown via MarkdownRenderer
   • Declarative; no manual DOM mutations.
-------------------------------------------------------------------*/
import { memo }           from 'preact/compat';
import MarkdownRenderer   from './MarkdownRenderer.jsx';

/* flatten an array-of-blocks or arbitrary value → plain string */
function flattenContent(content) {
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return String(content ?? '');
}

function MessageItem({ m }) {
  const text = flattenContent(m.content);

  return (
    <div className="message-content-inner">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  );
}

/* memo comparator: same id & identical content → skip re-render */
export default memo(
  MessageItem,
  (prev, next) =>
    prev.m.id === next.m.id &&
    JSON.stringify(prev.m.content) === JSON.stringify(next.m.content)
);