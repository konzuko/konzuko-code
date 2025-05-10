import ReactMarkdown       from 'react-markdown';
import remarkGfm           from 'remark-gfm';
import rehypeRaw           from 'rehype-raw';
import rehypeSanitize      from 'rehype-sanitize';
import { defaultSchema }   from 'hast-util-sanitize';

import CodeBlock           from './CodeBlock.jsx';

/*
  We extend the default sanitize schema so highlight.js classes on
  <span>, <code>, and <pre> aren't removed.
*/
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span || []), 'class'],
    code: [...(defaultSchema.attributes?.code || []), 'class'],
    pre:  [...(defaultSchema.attributes?.pre  || []), 'class']
  }
};

// We'll parse code fences like ```lang and also scrub trailing punctuation
const LANG_RE = /language-([^\s]+)/;

export default function MarkdownRenderer({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw, // parse raw HTML in content
        [rehypeSanitize, schema] // then sanitize
      ]}
      components={{
        code({ inline, className, children }) {
          // Inline code is rendered plainly (no copying syntax UI).
          const codeString = String(children).replace(/\n$/, '');
          if (inline) {
            return <code className={className}>{children}</code>;
          }

          // For fenced blocks, we parse the language from className
          const match = LANG_RE.exec(className || '');
          const rawLang = match ? match[1] : '';
          // Remove trailing punctuation, e.g. "sh:" => "sh"
          const finalLang = rawLang.replace(/[:;,.]+$/, '');

          return (
            <CodeBlock code={codeString} language={finalLang} />
          );
        }
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
