Below is the complete “useMessages.js” file, modified to add a plainText property during normalization (option A). You can overwrite your existing file verbatim. No lines are omitted.

────────────────────────────────────────────────────────
FILE: src/hooks/useMessages.js
────────────────────────────────────────────────────────
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'preact/hooks'
import { supabase } from '../lib/supabase.js'
import { toast }    from '../lib/toast.js'

const PAGE = 50

/* ─────────────────────────────────────────────────────────────────
   Utilities for converting message content to plain text + checksums
   ───────────────────────────────────────────────────────────────── */
function toPlain(blocks) {
  if (Array.isArray(blocks)) {
    return blocks
      .map(b => (b.type === 'text' ? b.text : '[non-text]'))
      .join('')
  }
  return String(blocks)
}

// FNV-1a 32-bit
function checksum32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) * 0x01000193 >>> 0
  }
  return h
}

/**
 * Add .checksum and .plainText if not present
 */
function addChecksum(row) {
  const plain = toPlain(row.content)
  if (!row.checksum)  row.checksum  = checksum32(plain)
  if (!row.plainText) row.plainText = plain
  return row
}

/* ─────────────────────────────────────────────────────────────────
   PAGING FETCH
   ───────────────────────────────────────────────────────────────── */
async function fetchOlder({ pageParam, queryKey }) {
  const [, chatId] = queryKey

  let q = supabase
    .from('messages')
    .select('id,role,content,created_at,updated_at,checksum,plainText')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(PAGE)

  // fetch only older than the pageParam
  if (pageParam) {
    q = q.lt('created_at', pageParam)
  }

  const { data, error } = await q
  if (error) throw error

  // normalize each row
  const rows = data.map(addChecksum)

  // next cursor if we got a full page of results
  const nextCursor = (rows.length === PAGE)
    ? rows[rows.length - 1].created_at
    : undefined

  return { data: rows, nextCursor }
}

/* ─────────────────────────────────────────────────────────────────
   USEMESSAGES HOOK
   ───────────────────────────────────────────────────────────────── */
export function useMessages(chatId) {
  const qc  = useQueryClient()
  const key = useMemo(() => ['msgs', chatId], [chatId])

  // infiniteQuery for older messages
  const query = useInfiniteQuery(key, fetchOlder, {
    getNextPageParam: last => last.nextCursor,
    enabled: Boolean(chatId)
  })

  // realtime subscription for new inserts
  useEffect(() => {
    if (!chatId) return

    const uid = crypto.randomUUID().slice(0, 8)
    const channelName = `msgs_${chatId}_${uid}`

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes',
          {
            event:  'INSERT',
            schema: 'public',
            table:  'messages',
            filter: `chat_id=eq.${chatId}`
          },
          ({ new: rowRaw }) => {
            const row = addChecksum(rowRaw)

            qc.setQueryData(key, old => {
              if (!old) return old

              // Avoid duplicates
              if (old.pages[0].data.some(r => r.id === row.id)) {
                return old
              }

              // Insert new row at the front of first page
              const firstPage = [ row, ...old.pages[0].data ]
              // keep the page length <= PAGE
              if (firstPage.length > PAGE) firstPage.pop()

              return {
                ...old,
                pages: [
                  { ...old.pages[0], data: firstPage },
                  ...old.pages.slice(1)
                ]
              }
            })
          }
      )
      .on('error', e => toast('Realtime error: ' + e.message))
      .subscribe()

    // cleanup on unmount or change chatId
    return () => {
      qc.cancelQueries(key)
      channel.unsubscribe()
    }
  }, [chatId, key, qc])

  return query
}