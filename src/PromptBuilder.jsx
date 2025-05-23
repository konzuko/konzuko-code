/* src/PromptBuilder.jsx
   - Adds auto-expansion to textareas with max-height
   - Imports useMemo
*/
import { useEffect, useRef, useMemo } from 'preact/hooks'; 
import { del }               from 'idb-keyval'; 
import CodebaseImporter      from './CodebaseImporter.jsx'; // Updated import
import { autoResizeTextarea } from './lib/domUtils.js'; // Import from lib

const MAX_PROMPT_TEXTAREA_HEIGHT = 250; // px

export default function PromptBuilder({
  mode, setMode,

  form, setForm,
  loadingSend, handleSend, 
  showToast,

  imagePreviews = [],          
  pdfPreviews   = [],          
  onRemoveImage,

  onAddImage,
  onAddPDF,

  settings, 
  pendingFiles, onFilesChange,
  onProjectRootChange, // Callback for CodebaseImporter to notify builder of root changes
  promptBuilderRootName // Builder's current root name, for CodebaseImporter to listen to
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
    // ['CONTEXT',      'developContext',      4] // Removed as per request
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
      showToast?.('GOAL is required');
      return;
    }
    handleSend();
  }


  return (
    <div className="template-container">

      <div className="mode-selector form-group">
        {['DEVELOP', 'CODE CHECK', 'COMMIT'].map(m => ( // Swapped 'CODE CHECK' and 'COMMIT'
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
          onSkip={n => showToast?.(`${n} file${n>1?'s':''} ignored`)}
          onAddImage={onAddImage}
          onAddPDF={onAddPDF}
          settings={settings}
          onProjectRootChange={onProjectRootChange} 
          currentProjectRootNameFromBuilder={promptBuilderRootName} // Pass down the builder's root name
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

