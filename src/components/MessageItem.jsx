// src/components/MessageItem.jsx
import { memo } from 'preact/compat';
import MarkdownRenderer from './MarkdownRenderer.jsx';
import { getChecksum } from '../lib/checksumCache.js';
import { useSignedUrl } from '../hooks/useSignedUrl.js';

function DisplayImage({ block }) {
  const { url, isLoading, error } = useSignedUrl(block.image_url.path);
  const altText = block.image_url.original_name || 'User uploaded image';

  if (isLoading) {
    return <div style={{ margin: '8px 0', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '4px', border: '1px solid var(--border)' }}>Loading image: {altText}...</div>;
  }
  if (error) {
    return <div style={{ margin: '8px 0', padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: '4px', border: '1px solid var(--error)' }}>Error loading image: {altText}</div>;
  }
  if (!url) return null;

  return (
    <div style={{ marginTop: '8px', marginBottom: '8px' }}>
      <img
        src={url}
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
        if (block.type === 'image_url' && block.image_url && block.image_url.path) {
          return <DisplayImage key={`${m.id}-img-${index}`} block={block} />;
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
    const prevCk = getChecksum(prevProps.m);
    const nextCk = getChecksum(nextProps.m);
    return prevCk === nextCk;
  }
);
