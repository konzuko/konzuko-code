
import { useState, useRef, useEffect } from 'preact/hooks';
import 'highlight.js/styles/atom-one-dark.css';

/**
 * Wraps a <pre><code class="hljs…">…</code></pre> from rehype-highlight
 * and inserts a Copy button. On copy, we read preRef.current.innerText
 * to get the fully highlighted text (minus the HTML tags).
 */
export default function CodeBlock({ preProps, children }) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(null);
  const preRef              = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    try {
      // Grab the text from the <pre> itself
      const text = preRef.current?.innerText || '';
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Failed to copy');
    }
  }

  return (
    <div style={{ position: 'relative', margin: '1em 0' }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top:      '0.3em',
          right:    '0.3em',
          fontSize: '0.8em',
          padding:  '0.2em 0.6em',
        }}
      >
        {copied ? 'Copied!' : '📋'}
      </button>

      <pre ref={preRef} {...preProps} style={{ margin: 0 }}>
        {children}
      </pre>
    </div>
  );
}
