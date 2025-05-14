import { memo } from 'preact/compat';
import { getHtml } from '../lib/htmlCache.js';

/* Renders pre-sanitised HTML for the text part of a message. */
function MessageItem({ m }) {
  const html = getHtml(m.checksum, m.plainText);
  return (
    <div
      className={`message message-${m.role}`}
      data-id={m.id}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default memo(MessageItem, (a, b) => a.m.checksum === b.m.checksum);
