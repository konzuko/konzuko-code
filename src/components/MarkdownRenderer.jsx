
import { useState, useEffect }  from 'preact/hooks';
import ReactMarkdown            from 'react-markdown';
import remarkGfm                from 'remark-gfm';
import rehypeRaw                from 'rehype-raw';
import rehypeSanitize           from 'rehype-sanitize';
import rehypeHighlight          from 'rehype-highlight';

import CodeBlock                from './CodeBlock.jsx';

export default function MarkdownRenderer({ children }) {
  const [schema, setSchema] = useState(null);

  // 1) Lazy-load GitHub’s full sanitize rules, then allow class on code/span/pre:
  useEffect(() => {
    import('hast-util-sanitize/lib/github.json')
      .then(mod => {
        const githubSchema = mod.default || mod; // works whether ESM or CJS
        setSchema({
          ...githubSchema,
          attributes: {
            ...githubSchema.attributes,
            span: [...(githubSchema.attributes?.span || []), 'class'],
            code: [...(githubSchema.attributes?.code || []), 'class'],
            pre : [...(githubSchema.attributes?.pre  || []), 'class'],
          },
        });
      })
      .catch(err => console.error('Failed to load GitHub schema', err));
  }, []);

  // 2) Fallback until schema loads (no rehypeRaw or sanitization):
  if (!schema) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {String(children)}
      </ReactMarkdown>
    );
  }

  // 3) Once loaded, we do the full pipeline:
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw,                      // parse raw HTML
        [rehypeSanitize, schema],       // then sanitize
        rehypeHighlight                 // add <span class="hljs-...">
      ]}
      components={{
        // only override <pre> to inject our copy button wrapper:
        pre({ node, children, ...props }) {
          return (
            <CodeBlock preProps={props}>
              {children}
            </CodeBlock>
          );
        },
      }}
    >
      {String(children)}
    </ReactMarkdown>
  );
}

