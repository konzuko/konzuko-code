/* ------------------------------------------------------------------
   usePromptTokens(blocks[], model, debounceMs?)
   • blocks: [{ checksum:number, plainText:string }]
   • Debounced (2 s default) off-thread counting with leak-proof
     listener-handling.
-------------------------------------------------------------------*/
import { useEffect, useRef, useState } from 'preact/hooks';

const worker = new Worker(
  new URL('../workers/tokenWorker.js', import.meta.url),
  { type: 'module' }
);

/* HMR – kill worker on module dispose */
if (import.meta.hot) {
  import.meta.hot.dispose(() => worker.terminate());
}

export default function usePromptTokens(
  blocks     = [],
  model      = 'gpt-3.5-turbo',
  debounceMs = 2000
) {
  const [count, setCount] = useState(0);

  const timerRef    = useRef();
  const reqIdRef    = useRef(0);
  const listenerRef = useRef(null);

  /* stable dependency key */
  const depKey =
    model + '|' +
    blocks.length + '|' +
    blocks.map(b => b.checksum).join(',');

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (listenerRef.current) {
      worker.removeEventListener('message', listenerRef.current);
      listenerRef.current = null;
    }

    if (!blocks.length) { setCount(0); return; }

    const requestId = ++reqIdRef.current;

    timerRef.current = setTimeout(() => {
      const list = blocks.map(b => ({ ck: b.checksum, text: b.plainText }));

      const listener = e => {
        if (e.data.id !== requestId) return;
        setCount(e.data.error ? 0 : e.data.total);
      };
      listenerRef.current = listener;

      worker.addEventListener('message', listener, { once: true });
      worker.postMessage({ id: requestId, model, list });
    }, debounceMs);

    return () => {
      clearTimeout(timerRef.current);
      if (listenerRef.current) {
        worker.removeEventListener('message', listenerRef.current);
        listenerRef.current = null;
      }
    };
  }, [depKey, debounceMs]);

  return count;
}
