import { useRef } from 'preact/hooks';
import useCopyToClipboard from '../hooks/useCopyToClipboard.js';
import 'highlight.js/styles/atom-one-dark.css';

/**
 * CodeBlock – wraps a <pre> and injects a copy button.
 * The button sits OUTSIDE the <pre> so its text is never copied.
 */
export default function CodeBlock({ preProps, children }) {
  const preRef = useRef(null);
  const [copy, copied] = useCopyToClipboard();

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