import { useState, useRef, useEffect } from 'preact/hooks';
import 'highlight.js/styles/atom-one-dark.css';
import Toast from './Toast.jsx';
import { copyToClipboard } from '../lib/copy.js';

/**
 * Copy wrapper for MarkdownRenderer path (still used in edit mode)
 */
export default function CodeBlock({ preProps, children }) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(null);
  const preRef              = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function handleCopy() {
    const text = preRef.current?.innerText || '';
    const ok   = await copyToClipboard(text);

    if (ok) {
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } else {
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
          padding:  '0.2em 0.7em',
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
