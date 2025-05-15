
/* -------------------------------------------------------------------------
   PromptBuilder – final drag-free version
   • No useFileDrop, no fileNames badge logic
   • CONTEXT textarea still syncs via IndexedDB + BroadcastChannel
---------------------------------------------------------------------------*/
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { get, set }  from 'idb-keyval';
import FilePane      from './FilePane.jsx';

const FIELD_KEYS = [
  'developGoal',
  'developFeatures',
  'developReturnFormat',
  'developWarnings',
  'developContext'       // ← include context so we never miss the key
];

export default function PromptBuilder({
  mode, setMode,
  form, setForm,
  loadingSend,
  handleSend,
  showToast,
  onImageDrop,
  onRemoveImage,
  imagePreviews
}) {
  /* ────────── CONTEXT (IndexedDB + BC) ────────── */
  const [ctx, setCtx]     = useState('');
  const [loaded, setLoad] = useState(false);

  /* 1) hydrate once */
  useEffect(() => {
    get('devCtx').then(v => {
      setCtx(v || '');
      setLoad(true);
    });
  }, []);

  /* 2) cross-tab sync */
  const bc = useMemo(() => new BroadcastChannel('devCtx'), []);
  useEffect(() => {
    bc.onmessage = e => setCtx(e.data);
    return () => bc.close();
  }, []);

  /* 3) persist helper */
  const flush = useCallback(() => set('devCtx', ctx), [ctx]);

  /* 4) tab-hide flush */
  useEffect(() => {
    const hide = () =>
      document.visibilityState === 'hidden' && flush();
    addEventListener('visibilitychange', hide);
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('visibilitychange', hide);
      removeEventListener('pagehide', flush);
    };
  }, [flush]);

  /* ---------- SEND ---------- */
  async function onSend() {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required');
      return;
    }
    // copy latest context into form, persist, then call outer send
    setForm(f => ({ ...f, developContext: ctx }));
    await flush();
    handleSend();
  }

  /* ─────────── UI ─────────── */
  if (!loaded) return <p style={{ padding: '1rem' }}>Loading draft…</p>;

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

      {/* DEVELOP fields */}
      {mode === 'DEVELOP' && fields.map(([label, key, rows]) => {
        const isCtx  = key === 'developContext';
        const value  = isCtx ? ctx : form[key];
        const update = isCtx
          ? e => { const v = e.target.value; setCtx(v); bc.postMessage(v); }
          : e => setForm(f => ({ ...f, [key]: e.target.value }));

        return (
          <div key={key} className="form-group">
            <label>{label}:</label>
            <textarea
              rows={rows}
              className="form-textarea"
              value={value}
              onInput={update}
              onBlur={isCtx ? flush : undefined}
            />
          </div>
        );
      })}

      {/* file pane (buttons only) */}
      {mode === 'DEVELOP' && (
        <FilePane
          form={form}
          setForm={setForm}
          onPasteImage={(n, u, r) =>
            onImageDrop?.(prev => [...prev, { name: n, url: u, revoke: r }])
          }
          onSkip={cnt =>
            showToast?.(`${cnt} non-text file${cnt > 1 ? 's were' : ' was'} ignored`)
          }
        />
      )}

      {/* image previews */}
      {imagePreviews.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          margin: '8px 0'
        }}>
          {imagePreviews.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={img.url} alt={img.name}
                   style={{ width: 100, borderRadius: 4 }} />
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
                onClick={() => { img.revoke?.(); onRemoveImage(i); }}
              >
                ×
              </div>
              <div style={{
                fontSize: '0.7rem',
                color: '#ccc',
                textAlign: 'center',
                width: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2
              }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* send */}
      <button
        className="button send-button"
        disabled={loadingSend}
        onClick={onSend}
      >
        {loadingSend ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
