import { memo } from 'preact/compat'
import MarkdownRenderer from './MarkdownRenderer.jsx'


function MessageItem ({ m }) {
return (
<div className={message message-${m.role}} data-id={m.id}>
{m.plainText ?? ''}

)
}


export default memo(MessageItem, (a, b) =>
a.m.id        === b.m.id &&
a.m.updated_at === b.m.updated_at &&
a.m.checksum   === b.m.checksum
)

