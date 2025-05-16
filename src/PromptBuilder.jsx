/* src/PromptBuilder.jsx */
/* PromptBuilder – file list + live token counter (no BroadcastChannel) */

import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { get, set }           from 'idb-keyval';

import FilePane               from './FilePane.jsx';
import { checksum32 }         from './lib/checksum.js';
import usePromptTokenCount    from './hooks/usePromptTokenCount.js';

export default function PromptBuilder({
  mode, setMode,
  form, setForm,
  loadingSend,
  handleSend,
  showToast,
  onImageDrop,
  onRemoveImage,
  imagePreviews,
  settings,
  pendingFiles,
  onFilesChange
}) {
  /* ───────── context (IndexedDB only) ───────── */
  const [ctx, setCtx]     = useState('');
  const [loaded, setLoad] = useState(false);

  /* hydrate */
  useEffect(() => {
    let live = true;
    get('devCtx').then(v => {
      if (live) { setCtx(v || ''); setLoad(true); }
    });
    return () => { live = false; };
  }, []);

  /* persist helper */
  const flushCtx = useCallback(() => set('devCtx', ctx), [ctx]);

  /* flush on tab hide */
  useEffect(() => {
    const hide = () => document.visibilityState === 'hidden' && flushCtx();
    addEventListener('visibilitychange', hide);
    addEventListener('pagehide', flushCtx);
    return () => {
      removeEventListener('visibilitychange', hide);
      removeEventListener('pagehide', flushCtx);
    };
  }, [flushCtx]);

  /* ───────── token counter ───────── */
  const fileBlocks = useMemo(
    () => pendingFiles.map(f => ({ checksum: checksum32(f.text), text: f.text })),
    [pendingFiles]
  );

  const textAreas = [
    form.developGoal,
    form.developFeatures,
    form.developReturnFormat,
    form.developWarnings,
    ctx
  ];

  const tokenCount = usePromptTokenCount({
    files: fileBlocks,
    textAreas,
    model: settings.model,
    debounceMs: 1250
  });

  /* ───────── send wrapper ───────── */
  async function onSend() {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required'); return;
    }
    setForm(f => ({ ...f, developContext: ctx }));
    await flushCtx();
    handleSend();
  }

  /* ───────── UI ───────── */
  if (!loaded) return <p style={{padding:'1rem'}}>Loading draft…</p>;

  const fields = [
    ['GOAL',                        'developGoal',         2],
    ['FEATURES',                    'developFeatures',     2],
    ['RETURN FORMAT',               'developReturnFormat', 2],
    ['THINGS TO REMEMBER/WARNINGS', 'developWarnings',     2],
    ['CONTEXT',                     'developContext',      4]
  ];

  return (
    <div className="template-container">
      {/* mode tabs */}
      <div className="mode-selector form-group">
        {['DEVELOP','COMMIT','CODE CHECK'].map(m=>(
          <button
            key={m}
            className={mode===m ? 'button active' : 'button'}
            onClick={()=>setMode(m)}
          >{m}</button>
        ))}
      </div>

      {/* develop text fields */}
      {mode==='DEVELOP' && fields.map(([label,key,rows])=>{
        const isCtx  = key==='developContext';
        const value  = isCtx ? ctx : form[key];
        const update = isCtx
          ? e => setCtx(e.target.value)
          : e => setForm(f => ({ ...f, [key]: e.target.value }));

        return (
          <div key={key} className="form-group">
            <label>{label}:</label>
            <textarea
              rows={rows}
              className="form-textarea"
              value={value}
              onInput={update}
              onBlur={isCtx ? flushCtx : undefined}
            />
          </div>
        );
      })}

      {/* file pane */}
      {mode==='DEVELOP' && (
        <FilePane
          files         ={pendingFiles}
          onFilesChange ={onFilesChange}
          onSkip        ={n => showToast?.(
            `${n} file${n>1?'s':' was'} ignored`
          )}
        />
      )}

      {/* image previews */}
      {imagePreviews.length>0 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,margin:'8px 0'}}>
          {imagePreviews.map((img,i)=>(
            <div key={i} style={{position:'relative'}}>
              <img src={img.url} alt={img.name} style={{width:100,borderRadius:4}}/>
              <div
                style={{
                  position:'absolute',top:2,right:2,width:20,height:20,
                  borderRadius:'50%',background:'rgba(0,0,0,0.6)',
                  color:'#fff',textAlign:'center',lineHeight:'20px',
                  cursor:'pointer'
                }}
                title="Remove image"
                onClick={()=>{ img.revoke?.(); onRemoveImage(i); }}
              >×</div>
              <div style={{
                fontSize:'0.7rem',color:'#ccc',textAlign:'center',
                width:100,overflow:'hidden',textOverflow:'ellipsis',
                whiteSpace:'nowrap',marginTop:2
              }}>{img.name}</div>
            </div>
          ))}
        </div>
      )}

      {/* footer */}
      <div style={{display:'flex',justifyContent:'space-between',marginTop:12}}>
        <div style={{padding:'6px 12px',background:'#0f2540',borderRadius:4}}>
          Tokens: {tokenCount.toLocaleString()}
        </div>
        <button
          className="button send-button"
          disabled={loadingSend}
          onClick={onSend}
        >{loadingSend ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  );
}