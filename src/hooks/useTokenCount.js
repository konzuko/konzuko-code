/* -----------------------------------------------------------------------
   useTokenCount – chat-pane token counter (no debounce)
   • Uses the shared worker + Promise RPC
   • Guards against out-of-order replies
------------------------------------------------------------------------ */
import { useEffect, useRef, useState } from 'preact/hooks';
import { countTokens }                 from '../lib/tokenWorkerClient.js';

export default function useTokenCount(messages = [], model = 'gpt-3.5-turbo') {
  const [count, setCount] = useState(0);
  const cancelled         = useRef(false);
  const versionRef        = useRef(0);

  useEffect(() => {
    if (!messages.length) { setCount(0); return; }

    const list = messages.map(m => ({
      ck  : m.checksum,
      text: m.plainText
    }));

    const myVersion = ++versionRef.current;

    (async () => {
      try {
        const total = await countTokens(model, list);
        if (!cancelled.current && myVersion === versionRef.current) {
          setCount(total);
        }
      } catch {
        if (!cancelled.current && myVersion === versionRef.current) {
          setCount(0);
        }
      }
    })();

    return () => { cancelled.current = true; };
  }, [messages, model]);

  return count;
}
