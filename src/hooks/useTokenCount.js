/* -----------------------------------------------------------------------
   useTokenCount(messages, model, draft)
   • counts tokens in a Web-Worker without blocking UI
   • immediate recount on message-list change
   • while editing, debounced to once every 4 s if text changed
------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from 'preact/hooks';
import { checksum32 } from '../lib/checksum.js';

const worker = new Worker(
  new URL('../workers/tokenWorker.js', import.meta.url),
  { type: 'module' }
);

/* kill worker & listeners on Vite HMR */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker.terminate();
    worker.onmessage = null;
  });
}

/**
 * @param {Array}  messages – rows containing { checksum, plainText }
 * @param {string} model    – Model name (e.g. 'gpt-3.5-turbo')
 * @param {object|null} draft – { id, text } during live edit
 */
export default function useTokenCount(messages = [], model = 'gpt-3.5-turbo', draft = null) {
  const [count, setCount] = useState(0);
  const reqIdRef          = useRef(0);
  const debounceRef       = useRef(null);

  /* helper to send work and accept reply for *this* id only */
  function dispatch(list) {
    const id = ++reqIdRef.current;
    worker.postMessage({ model, list });

    const handler = e => {
      if (id !== reqIdRef.current) return;          // stale reply
      if (e.data.error) {
        console.warn('tokenWorker:', e.data.error);
        setCount(0);
      } else {
        setCount(e.data.total);
      }
    };
    worker.addEventListener('message', handler, { once: true });
  }

  /* 1) immediate recount on message list change */
  useEffect(() => {
    if (!messages.length) { setCount(0); return; }
    const list = messages.map(m => ({ ck: m.checksum, text: m.plainText }));
    dispatch(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, model]);      // NOT depending on draft

  /* 2) debounced recount while editing */
  useEffect(() => {
    if (!draft) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const list = messages.map(m =>
        (m.id === draft.id)
          ? { ck: checksum32(draft.text), text: draft.text }
          : { ck: m.checksum, text: m.plainText }
      );
      dispatch(list);
    }, 4000);                                    // ← 4 seconds

    return () => clearTimeout(debounceRef.current);
  }, [draft?.text, draft?.id, model]);           // messages intentionally omitted

  return count;
}
