/* -----------------------------------------------------------------------
   usePromptTokenCount – live counter for Prompt-Builder
   • Instant recount on files[] / model change
   • 1.25 s debounced recount after last keystroke
   • Guards against out-of-order replies
------------------------------------------------------------------------ */
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { checksum32 }          from '../lib/checksum.js';
import { countTokens }         from '../lib/tokenWorkerClient.js';

export default function usePromptTokenCount({
  files      = [],            // [{ text, checksum }]
  textAreas  = [],            // Array<string>
  model      = 'gpt-3.5-turbo',
  debounceMs = 1250
} = {}) {
  const [count, setCount] = useState(0);
  const timerRef          = useRef(null);
  const cancelled         = useRef(false);
  const versionRef        = useRef(0);     // monotonically-increasing “request version”

  /* build worker payload */
  const buildList = useCallback(() => {
    const list = [];
    for (const f of files)     list.push({ ck: f.checksum, text: f.text });
    for (const t of textAreas) list.push({ ck: checksum32(t), text: t });
    return list;
  }, [files, textAreas]);

  /* main updater */
  const update = useCallback(async () => {
    const myVersion = ++versionRef.current;
    try {
      const total = await countTokens(model, buildList());
      if (!cancelled.current && myVersion === versionRef.current) {
        setCount(total);
      }
    } catch {
      if (!cancelled.current && myVersion === versionRef.current) {
        setCount(0);
      }
    }
  }, [model, buildList]);

  /* 1) files / model → instant recount */
  useEffect(() => {
    const nothing = files.length === 0 && textAreas.every(t => !t);
    if (nothing) { setCount(0); return; }
    update();
  }, [files, model, update]);

  /* 2) debounced recount while typing */
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(update, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [textAreas, update, debounceMs]);

  /* cleanup */
  useEffect(() => () => { cancelled.current = true; }, []);

  return count;
}