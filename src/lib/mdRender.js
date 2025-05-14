/* -----------------------------------------------------------------------
   Pure function: Markdown (string)  →  sanitised, syntax-highlighted HTML
   ‑ Uses unified/remark/rehype pipeline
   ‑ Allows class on <code>/<pre>/<span> so highlight.js can style
------------------------------------------------------------------------ */
import { unified }       from 'unified';
import remarkParse       from 'remark-parse';
import remarkGfm         from 'remark-gfm';
import remarkRehype      from 'remark-rehype';
import rehypeRaw         from 'rehype-raw';
import rehypeSanitize    from 'rehype-sanitize';
import rehypeHighlight   from 'rehype-highlight';
import rehypeStringify   from 'rehype-stringify';
import { defaultSchema } from 'rehype-sanitize';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    pre : [...(defaultSchema.attributes?.pre  || []), 'className'],
    span: [...(defaultSchema.attributes?.span || []), 'className']
  }
};

export function mdToSafeHtml(markdown = '') {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(rehypeHighlight)
    .use(rehypeStringify)
    .processSync(markdown)
    .toString();
}
