/* src/PromptBuilder.jsx
   - Adds auto-expansion to textareas with max-height
   - Imports useMemo
*/
import { useEffect, useRef, useMemo } from 'preact/hooks'; 
import { del }               from 'idb-keyval'; 
import CodebaseImporter      from './CodebaseImporter.jsx'; 
import { autoResizeTextarea } from './lib/domUtils.js'; 

const MAX_PROMPT_TEXTAREA_HEIGHT = 250; // px

export default function PromptBuilder({
  mode, setMode,

  form, setForm,
  loadingSend, handleSend, 
  showToast, // This is the Toast function from App.jsx

  imagePreviews = [],          
  pdfPreviews   = [],          
  onRemoveImage,

  onAddImage,
  onAddPDF,

  settings, 
  pendingFiles, onFilesChange,
  onProjectRootChange, 
  promptBuilderRootName 
}) {
  const formRef = useRef(form);
  const textareaRefs = useRef({}); 

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
    const vis = () => document.visibilityState === 'hidden' && flush();
    addEventListener('visibilitychange', vis);
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('visibilitychange', vis);
      removeEventListener('pagehide', flush);
    };
  }, []);

  useEffect(() => { del('devCtx').catch(() => {}); }, []);

  const fields = useMemo(() => [ 
    ['GOAL',         'developGoal',         2],
    ['FEATURES',     'developFeatures',     2],
    ['RETURN FORMAT','developReturnFormat', 2],
    ['THINGS TO REMEMBER/WARNINGS','developWarnings',2],
  ], []);

  useEffect(() => {
    if (mode === 'DEVELOP') {
      fields.forEach(([, key]) => {
        if (textareaRefs.current[key]) {
          autoResizeTextarea(textareaRefs.current[key], MAX_PROMPT_TEXTAREA_HEIGHT);
        }
      });
    }
  }, [form, fields, mode]); 

  function guardedSend() {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required', 3000); // Added duration
      return;
    }
    handleSend();
  }


  return (
    <div className="template-container">

      <div className="mode-selector form-group">
        {['DEVELOP', 'CODE CHECK', 'COMMIT'].map(m => ( 
          <button
            key={m}
            className={mode === m ? 'button active' : 'button'}
            onClick={() => setMode(m)}
          >{m}</button>
        ))}
      </div>

      {mode === 'DEVELOP' && fields.map(([lbl, key, rows]) => (
        <div key={key} className="form-group">
          <label>{lbl}:</label>
          <textarea
            ref={el => textareaRefs.current[key] = el}
            rows={rows}
            className="form-textarea"
            style={{ maxHeight: `${MAX_PROMPT_TEXTAREA_HEIGHT}px` }} 
            value={form[key]}
            onInput={e => {
              setForm(f => ({ ...f, [key]: e.target.value }));
              autoResizeTextarea(e.target, MAX_PROMPT_TEXTAREA_HEIGHT);
            }}
          />
        </div>
      ))}

      {mode === 'DEVELOP' && (
        <CodebaseImporter 
          files={pendingFiles}
          onFilesChange={onFilesChange}
          toastFn={showToast} // Pass showToast as toastFn
          onAddImage={onAddImage}
          onAddPDF={onAddPDF}
          settings={settings}
          onProjectRootChange={onProjectRootChange} 
          currentProjectRootNameFromBuilder={promptBuilderRootName} 
        />
      )}

      {imagePreviews.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={`${img.url}-${i}`} style={{ position:'relative' }}> 
              <img src={img.url} alt={img.name} style={{ width:100, borderRadius:4 }} />
              <div
                onClick={() => onRemoveImage(i)}
                title="Remove image"
                style={{
                  position:'absolute', top:2, right:2,
                  width:20, height:20, borderRadius:'50%',
                  background:'rgba(0,0,0,0.65)', color:'#fff',
                  textAlign:'center', lineHeight:'20px', cursor:'pointer'
                }}
              >×</div>
              <div style={{
                width:100, marginTop:2, fontSize:'0.7rem',
                overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                textAlign:'center', color:'var(--text-secondary)' 
              }}>{img.name}</div>
            </div>
          ))}
        </div>
      )}

      {pdfPreviews.length > 0 && (
        <div style={{ margin:'8px 0' }}>
          <strong>PDFs:</strong>
          <ul style={{ margin:'4px 0 0 16px', paddingLeft: '0', listStylePosition: 'inside' }}> 
            {pdfPreviews.map((p,i)=><li key={`${p.fileId}-${i}`}>{p.name}</li>)} 
          </ul>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'flex-end', alignItems: 'center', marginTop:'auto', paddingTop: '12px' }}> 
        <div style={{ position: 'relative' }}> 
          <button
            className="button send-button"
            disabled={loadingSend}
            onClick={guardedSend}
          >
            {loadingSend ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
