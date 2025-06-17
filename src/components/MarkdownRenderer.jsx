// file: src/components/MarkdownRenderer.jsx
import { useMemo } from 'preact/hooks'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema as githubSchema } from 'rehype-sanitize'

import CodeBlock from './CodeBlock.jsx'

export default function MarkdownRenderer({ children }) {
  // FIX: Extend the default GitHub schema to allow table-related elements.
  // This is the secure way to enable tables, as it keeps the sanitizer
  // active but teaches it to permit the necessary tags and attributes.
  const schema = useMemo(() => ({
    ...githubSchema,
    tagNames: [
      ...(githubSchema.tagNames || []),
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    attributes: {
      ...githubSchema.attributes,
      // Allow class for syntax highlighting on these tags
      span: [...(githubSchema.attributes?.span || []), ['className']],
      code: [...(githubSchema.attributes?.code || []), ['className']],
      pre: [...(githubSchema.attributes?.pre || []), ['className']],
      // Allow the 'align' attribute on table header and data cells
      th: [...(githubSchema.attributes?.th || []), 'align'],
      td: [...(githubSchema.attributes?.td || []), 'align'],
    },
  }), [])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw,                // parse any embedded HTML
        [rehypeSanitize, schema], // sanitize it using our extended schema
        rehypeHighlight           // syntax‐highlight code blocks
      ]}
      components={{
        // wrap every <pre> so CodeBlock can inject a "Copy" button
        pre({ node, children, ...props }) {
          return (
            <CodeBlock preProps={props}>
              {children}
            </CodeBlock>
          )
        },
      }}
    >
      {String(children)}
    </ReactMarkdown>
  )
}
