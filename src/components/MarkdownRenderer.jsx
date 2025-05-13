import { useMemo } from 'preact/hooks'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema as githubSchema } from 'rehype-sanitize'

import CodeBlock from './CodeBlock.jsx'

export default function MarkdownRenderer({ children }) {
  // create one memoized schema: start from GitHub's rules,
  // then allow `class` on span/code/pre for syntax highlighting
  const schema = useMemo(() => ({
    ...githubSchema,
    attributes: {
      ...githubSchema.attributes,
      span: [...(githubSchema.attributes?.span || []), 'class'],
      code: [...(githubSchema.attributes?.code || []), 'class'],
      pre: [...(githubSchema.attributes?.pre || []), 'class'],
    },
  }), [])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        rehypeRaw,                // parse any embedded HTML
        [rehypeSanitize, schema], // sanitize it using GitHub's rules + our tweaks
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
