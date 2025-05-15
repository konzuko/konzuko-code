import { useState, useRef, useEffect } from 'preact/hooks';
import 'highlight.js/styles/atom-one-dark.css';
import Toast from './Toast.jsx';

/**
 * Copy wrapper for MarkdownRenderer path (still used in edit mode)
 */
export default function CodeBlock({ preProps, children }) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(null);
  const preRef              = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function handleCopy() {
    try {
      const text = preRef.current?.innerText || '';
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      Toast('Copy failed', 2000);
    }
  }

  return (
    <div style={{ position: 'relative', margin: '1em 0' }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top:  '0.3em',
          right:'0.3em',
          fontSize: '0.75rem',
          padding:  '0.2em 0.7em',     // widened for the word “Copy”
          zIndex: 2
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>

      <pre ref={preRef} {...preProps} style={{ margin: 0 }}>
        {children}
      </pre>
    </div>
  );
}