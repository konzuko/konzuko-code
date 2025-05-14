import { useRef, useLayoutEffect, useEffect } from 'preact/hooks'
import { VariableSizeList as List } from 'react-window'
import { useMessages } from '../hooks/useMessages.js'
import MessageItem from './MessageItem.jsx'


export default function ChatView ({ chatId }) {
const {
data,
fetchNextPage,
hasNextPage,
isFetchingNextPage
} = useMessages(chatId)


const msgs = (data?.pages.flatMap(p => p.data) || []).reverse()


/* height cache + reset on length change */
const sizes = useRef(new Map())
const listRef = useRef(null)


useEffect(() => {
sizes.current.clear()
listRef.current?.resetAfterIndex(0, true)
}, [msgs.length])


const getSize = i => sizes.current.get(i) ?? 300


if (!chatId) {
return <div style={{ padding: '1rem' }}>Pick a chat
}


function Row ({ index, style }) {
const rowRef = useRef(null)
const msg = msgs[index]


📋
useLayoutEffect(() => {
  const h = rowRef.current?.offsetHeight
  if (h && h !== sizes.current.get(index)) {
    sizes.current.set(index, h)
    listRef.current?.resetAfterIndex(index)
  }
}, [index, msg.updated_at])

return (
  <div style={style}>
    <div ref={rowRef}>
      <MessageItem m={msg} />
    </div>
  </div>
)

}


return (
<div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
{hasNextPage && (
<button
style={{
position: 'absolute',
top: 0,
left: '50%',
transform: 'translateX(-50%)',
zIndex: 10
}}
disabled={isFetchingNextPage}
onClick={() => fetchNextPage()}
>
{isFetchingNextPage ? 'Loading…' : 'Load older'}

)}


📋
  <List
    ref={listRef}
    height={window.innerHeight - 200}
    itemCount={msgs.length}
    itemSize={getSize}
    itemKey={i => msgs[i].id}
    width="100%"
  >
    {Row}
  </List>
</div>

)
}