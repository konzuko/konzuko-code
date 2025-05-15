/* ------------------------------------------------------------------
   tokenWorkerSingleton
   • Exactly ONE Worker shared across the whole app
   • allocId() → monotonically-increasing request id
-------------------------------------------------------------------*/
const tokenWorker = new Worker(
    new URL('../workers/tokenWorker.js', import.meta.url),
    { type: 'module' }
  );
  
  /* global id counter */
  let nextId = 1;
  export function allocId() {
    return nextId++;
  }
  
  /* HMR – kill worker, then hard-reload so all hooks re-attach */
  if (import.meta.hot) {
    import.meta.hot.dispose(() => tokenWorker.terminate());
    import.meta.hot.accept(() => location.reload());
  }
  
  export default tokenWorker;
  