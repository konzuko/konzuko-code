// src/components/CodeBlock.jsx
import { useRef } from 'preact/hooks';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import 'highlight.js/styles/atom-one-dark.css';

/**
 * CodeBlock – wraps a <pre> produced by MarkdownRenderer,
 * injects a “Copy” button in a declarative way.
 */
export default function CodeBlock({ preProps, children }) {
  const preRef = useRef(null);

  const [copy, copied] = useCopyToClipboard({
    successMsg: 'Copied!',
    errorMsg:   'Copy failed',
    successMs:  1500,
    errorMs:    2000
  });

  function handleCopy(e) {
    e.stopPropagation();
    copy(preRef.current?.innerText || '');
  }

  return (
    <div className="code-wrapper">
      <button
        className={copied ? 'copy-snippet copy-snippet--copied' : 'copy-snippet'}
        onClick={handleCopy}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>

      <pre ref={preRef} {...preProps} style={{ margin: 0 }}>
        {children}
      </pre>
    </div>
  );
}