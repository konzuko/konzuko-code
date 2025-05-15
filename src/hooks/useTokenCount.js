/* --------------------------------------------------------------------------
   useTokenCount – chat-pane + prompt token counter (no debounce)

   • Accepts raw Supabase rows:  [{ id, role, content:[{type,text},…] }]
   • Internally flattens → { ck , text } for the worker.
   • Uses shared Promise-RPC client so only ONE Worker exists.
---------------------------------------------------------------------------*/
import { useEffect, useRef, useState } from 'preact/hooks';
import { countTokens } from '../lib/tokenWorkerClient.js';
import { checksum32 }  from '../lib/checksum.js';

export default function useTokenCount(
  messages = [],
  model     = 'gpt-3.5-turbo'
) {
  const [count, setCount] = useState(0);
  const cancelled  = useRef(false);
  const versionRef = useRef(0);

  /* Convert Supabase rows → payload for worker */
  function buildList() {
    return messages.map(row => {
      const txt = Array.isArray(row.content)
        ? row.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('')
        : String(row.content);
      return { ck: checksum32(txt), text: txt };
    });
  }

  useEffect(() => {
    cancelled.current = false;

    if (!messages.length) {
      setCount(0);
      return;
    }

    const list      = buildList();
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

    return () => {
      cancelled.current = true;
    };
  }, [messages, model]);

  return count;
}