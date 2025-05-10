import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import hljs from 'highlight.js/lib/core';
import { sanitize } from '../lib/sanitizer.js';

/*
  We import & register the canonical languages exactly once
  so highlight.js can properly color code fences and known aliases.
*/
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python     from 'highlight.js/lib/languages/python';
import bash       from 'highlight.js/lib/languages/bash';
import cpp        from 'highlight.js/lib/languages/cpp';
import csharp     from 'highlight.js/lib/languages/csharp';

if (!hljs.__konzukoRegistered) {
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('python',     python);
  hljs.registerLanguage('bash',       bash);
  hljs.registerLanguage('cpp',        cpp);
  hljs.registerLanguage('csharp',     csharp);
  hljs.__konzukoRegistered = true;
}

// Import your preferred theme for highlighted code
import 'highlight.js/styles/atom-one-dark.css';

/*
  Common aliases – if a code fence says "c++", we map it to "cpp".
  If it says "sh" or "shell", we map to "bash," etc.
*/
const ALIAS_MAP = {
  js:   'javascript',
  jsx:  'javascript',
  mjs:  'javascript',
  ts:   'typescript',
  tsx:  'typescript',
  py:   'python',
  sh:   'bash',
  shell:'bash',
  zsh:  'bash',
  ksh:  'bash',
  'c++': 'cpp',
  hpp:   'cpp',
  cc:    'cpp',
  cxx:   'cpp',
  'c#':  'csharp',
  cs:    'csharp'
};

export default function CodeBlock({ code, language = '' }) {
  // Convert to a known highlight.js key if possible
  const canonical = (ALIAS_MAP[language.toLowerCase()] || language).toLowerCase();

  // Memoize the highlighted HTML to avoid re-runs on every render
  const html = useMemo(() => {
    try {
      // If we know the language, highlight directly
      if (hljs.getLanguage(canonical)) {
        return hljs.highlight(code, { language: canonical }).value;
      }
      // Otherwise, auto-detect
      return hljs.highlightAuto(code).value;
    } catch {
      return hljs.highlightAuto(code).value;
    }
  }, [code, canonical]);

  // Then sanitize it to prevent XSS
  const safeHtml = useMemo(() => sanitize(html), [html]);

  // Copy-button feedback
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  // Cleanup the timer if unmounts happen quickly
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      if (timerRef.current) clearTimeout(timerRef.current);
      setCopied(true);
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
          top:  '0.3em',
          right:'0.3em',
          fontSize:'0.8em',
          padding:'0.2em 0.6em'
        }}
      >
        {copied ? 'Copied!' : '📋'}
      </button>

      <pre style={{ margin: 0 }}>
        {/* eslint-disable-next-line react/no-danger */}
        <code
          className={`hljs language-${canonical}`}
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      </pre>
    </div>
  );
}