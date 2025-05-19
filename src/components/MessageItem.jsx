// src/components/MessageItem.jsx
import { memo } from 'preact/compat';
import MarkdownRenderer from './MarkdownRenderer.jsx';
import { getChecksum } from '../lib/checksumCache.js';

// Note: flattenContentForChecksum was removed as getChecksum from checksumCache.js
// is expected to handle the flattening of text content from an array.

function MessageItem({ m }) {
  const contentArray = Array.isArray(m.content)
    ? m.content
    : [{ type: 'text', text: String(m.content ?? '') }];

  return (
    <div className="message-content-inner">
      {contentArray.map((block, index) => {
        if (block.type === 'text') {
          return <MarkdownRenderer key={`${m.id}-text-${index}`}>{block.text}</MarkdownRenderer>;
        }
        if (block.type === 'image_url' && block.image_url && block.image_url.url) {
          const altText = block.image_url.original_name || 'User uploaded image';
          return (
            <div key={`${m.id}-img-${index}`} style={{ marginTop: '8px', marginBottom: '8px' }}>
              <img
                src={block.image_url.url}
                alt={altText}
                style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', display: 'block' }}
              />
              {block.image_url.original_name && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '4px' }}>
                  {block.image_url.original_name}
                </div>
              )}
            </div>
          );
        }
        if (block.type === 'file' && block.file && block.file.file_id) {
          const fileName = block.file.original_name || `File ID: ${block.file.file_id}`;
          return (
            <div key={`${m.id}-file-${index}`}
                 style={{
                    margin: '8px 0',
                    padding: '8px 12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    fontSize: '0.9rem'
                 }}>
              📄 PDF: {fileName}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export default memo(
  MessageItem,
  (prevProps, nextProps) => {
    if (prevProps.m.id !== nextProps.m.id) return false;
    // getChecksum will internally flatten the text parts of m.content
    const prevCk = getChecksum(prevProps.m);
    const nextCk = getChecksum(nextProps.m);
    return prevCk === nextCk;
  }
);