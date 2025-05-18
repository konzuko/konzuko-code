/* src/PromptBuilder.jsx
   ──────────────────────────────────────────────────────────────
   Single-source CONTEXT (form.developContext)
   • IndexedDB draft removed
   • Pagehide/visibilitychange safety-flush (no leak)
   • Old devCtx key cleared once
   • onImageDrop prop deleted (was unused)
   ────────────────────────────────────────────────────────────── */

   import { useEffect, useRef } from 'preact/hooks';
   import { del }               from 'idb-keyval';
   
   import FilePane from './FilePane.jsx';
   
   export default function PromptBuilder({
     mode,
     setMode,
     form,
     setForm,
     loadingSend,
     handleSend,
     showToast,
     onRemoveImage,
     imagePreviews,
     settings,
     pendingFiles,
     onFilesChange
   }) {
     /* ──────────────────────────────────────────────────────────
        1. Force-flush latest draft on pagehide / tab-hide
     ────────────────────────────────────────────────────────── */
     const formRef = useRef(form);
     useEffect(() => { formRef.current = form; }, [form]);
   
     useEffect(() => {
       function flush() {
         try {
           const next = JSON.stringify(formRef.current);
           if (localStorage.getItem('konzuko-form-data') !== next) {
             localStorage.setItem('konzuko-form-data', next);
           }
         } catch {}
       }
       function visHandler() {
         if (document.visibilityState === 'hidden') flush();
       }
   
       addEventListener('visibilitychange', visHandler);
       addEventListener('pagehide',        flush);
       return () => {
         removeEventListener('visibilitychange', visHandler);
         removeEventListener('pagehide',        flush);
       };
     }, []);
   
     /* ──────────────────────────────────────────────────────────
        2. One-off: purge obsolete IndexedDB draft (“devCtx”)
     ────────────────────────────────────────────────────────── */
     useEffect(() => { del('devCtx').catch(() => {}); }, []);
   
     /* ───────── send wrapper ───────── */
     async function onSend() {
       if (mode === 'DEVELOP' && !form.developGoal.trim()) {
         showToast?.('GOAL is required');
         return;
       }
       handleSend();
     }
   
     /* ───────── fields definition ───────── */
     const fields = [
       ['GOAL',         'developGoal',         2],
       ['FEATURES',     'developFeatures',     2],
       ['RETURN FORMAT','developReturnFormat', 2],
       ['THINGS TO REMEMBER/WARNINGS','developWarnings',2],
       ['CONTEXT',      'developContext',      4]
     ];
   
     return (
       <div className="template-container">
         {/* mode tabs */}
         <div className="mode-selector form-group">
           {['DEVELOP', 'COMMIT', 'CODE CHECK'].map(m => (
             <button
               key={m}
               className={mode === m ? 'button active' : 'button'}
               onClick={() => setMode(m)}
             >
               {m}
             </button>
           ))}
         </div>
   
         {/* develop text fields */}
         {mode === 'DEVELOP' &&
           fields.map(([label, key, rows]) => (
             <div key={key} className="form-group">
               <label>{label}:</label>
               <textarea
                 rows={rows}
                 className="form-textarea"
                 value={form[key]}
                 onInput={e =>
                   setForm(f => ({ ...f, [key]: e.target.value }))
                 }
               />
             </div>
           ))}
   
         {/* file pane */}
         {mode === 'DEVELOP' && (
           <FilePane
             files={pendingFiles}
             onFilesChange={onFilesChange}
             onSkip={n =>
               showToast?.(`${n} file${n > 1 ? 's' : ''} ignored`)
             }
           />
         )}
   
         {/* image previews */}
         {imagePreviews.length > 0 && (
           <div
             style={{
               display: 'flex',
               flexWrap: 'wrap',
               gap: 8,
               margin: '8px 0'
             }}
           >
             {imagePreviews.map((img, i) => (
               <div key={i} style={{ position: 'relative' }}>
                 <img
                   src={img.url}
                   alt={img.name}
                   style={{ width: 100, borderRadius: 4 }}
                 />
                 <div
                   style={{
                     position: 'absolute',
                     top: 2,
                     right: 2,
                     width: 20,
                     height: 20,
                     borderRadius: '50%',
                     background: 'rgba(0,0,0,0.6)',
                     color: '#fff',
                     textAlign: 'center',
                     lineHeight: '20px',
                     cursor: 'pointer'
                   }}
                   title="Remove image"
                   onClick={() => {
                     img.revoke?.();
                     onRemoveImage(i);
                   }}
                 >
                   ×
                 </div>
                 <div
                   style={{
                     fontSize: '0.7rem',
                     color: '#ccc',
                     textAlign: 'center',
                     width: 100,
                     overflow: 'hidden',
                     textOverflow: 'ellipsis',
                     whiteSpace: 'nowrap',
                     marginTop: 2
                   }}
                 >
                   {img.name}
                 </div>
               </div>
             ))}
           </div>
         )}
   
         {/* footer */}
         <div
           style={{
             display: 'flex',
             justifyContent: 'flex-end',
             marginTop: 12
           }}
         >
           <button
             className="button send-button"
             disabled={loadingSend}
             onClick={onSend}
           >
             {loadingSend ? 'Sending…' : 'Send'}
           </button>
         </div>
       </div>
     );
   }
   