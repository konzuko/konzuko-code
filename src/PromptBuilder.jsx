/* src/PromptBuilder.jsx
   – Restores the “GOAL is required” guard (A-1)
*/
import { useEffect, useRef } from 'preact/hooks';
import { del }               from 'idb-keyval'; // For one-off purge
import FilePane              from './FilePane.jsx';

export default function PromptBuilder({
  mode, setMode,

  form, setForm,
  loadingSend, handleSend,
  showToast,

  imagePreviews = [],          // [{ name,url }]
  pdfPreviews   = [],          // [{ name,fileId, mimeType }]
  onRemoveImage,

  onAddImage,
  onAddPDF,

  settings, // Receive settings to pass to FilePane
  pendingFiles, onFilesChange
}) {
  /* ── persist draft on page-hide ─────────────────────────── */
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
    const vis = () => document.visibilityState === 'hidden' && flush();
    addEventListener('visibilitychange', vis);
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('visibilitychange', vis);
      removeEventListener('pagehide', flush);
    };
  }, []);

  /* one-off purge of old IndexedDB key */
  useEffect(() => { del('devCtx').catch(() => {}); }, []);

  /* “GOAL required” guard */
  function guardedSend() {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required');
      return;
    }
    handleSend();
  }

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
          >{m}</button>
        ))}
      </div>

      {/* DEVELOP text fields */}
      {mode === 'DEVELOP' && fields.map(([lbl, key, rows]) => (
        <div key={key} className="form-group">
          <label>{lbl}:</label>
          <textarea
            rows={rows}
            className="form-textarea"
            value={form[key]}
            onInput={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          />
        </div>
      ))}

      {/* File selector pane */}
      {mode === 'DEVELOP' && (
        <FilePane
          files={pendingFiles}
          onFilesChange={onFilesChange}
          onSkip={n => showToast?.(`${n} file${n>1?'s':''} ignored`)}
          onAddImage={onAddImage}
          onAddPDF={onAddPDF}
          settings={settings} // Pass settings to FilePane
        />
      )}

      {/* image thumbnails */}
      {imagePreviews.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={`${img.url}-${i}`} style={{ position:'relative' }}> {/* Ensure key is unique */}
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
                textAlign:'center', color:'var(--text-secondary)' // Updated color
              }}>{img.name}</div>
            </div>
          ))}
        </div>
      )}

      {/* PDF list */}
      {pdfPreviews.length > 0 && (
        <div style={{ margin:'8px 0' }}>
          <strong>PDFs:</strong>
          <ul style={{ margin:'4px 0 0 16px', paddingLeft: '0', listStylePosition: 'inside' }}> {/* Adjusted style */}
            {pdfPreviews.map((p,i)=><li key={`${p.fileId}-${i}`}>{p.name}</li>)} {/* Ensure key is unique */}
          </ul>
        </div>
      )}

      {/* footer */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'auto', paddingTop: '12px' }}> {/* marginTop: auto to push to bottom */}
        <button
          className="button send-button"
          disabled={loadingSend}
          onClick={guardedSend}
        >
          {loadingSend ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}