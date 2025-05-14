
/* -------------------------------------------------------------------------
   PromptBuilder – full version (five DEVELOP fields + file / image support)
   • developContext lives in IndexedDB (devCtx) and syncs across tabs
   • Uses showToast() prop for all toast notifications
---------------------------------------------------------------------------*/
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks'
import { get, set }        from 'idb-keyval'
import { useFileDrop }     from './hooks.js'
import FilePane            from './FilePane.jsx'

/* smaller DEVELOP fields kept in React state */
const FIELD_KEYS = [
  'developGoal',
  'developFeatures',
  'developReturnFormat',
  'developWarnings'
]

export default function PromptBuilder ({
  mode, setMode,
  form, setForm,
  loadingSend,
  handleSend,
  showToast,        // <<<  existing toast callback from App
  onImageDrop,
  onRemoveImage,
  imagePreviews
}) {
  /* ────────── big CONTEXT textarea (IndexedDB + BC) ────────── */
  const [ctx, setCtx]     = useState('')
  const [loaded, setLoad] = useState(false)

  /* 1) hydrate once */
  useEffect(() => {
    get('devCtx').then(v => {
      setCtx(v || '')
      setLoad(true)
    })
  }, [])

  /* 2) BroadcastChannel for cross-tab sync */
  const bc = useMemo(() => new BroadcastChannel('devCtx'), [])
  useEffect(() => {
    bc.onmessage = e => setCtx(e.data)
    return () => bc.close()
  }, [])

  /* 3) persist helper */
  const flush = useCallback(() => set('devCtx', ctx), [ctx])

  /* 4) tab-hide flush */
  useEffect(() => {
    const hide = () =>
      document.visibilityState === 'hidden' && flush()
    addEventListener('visibilitychange', hide)
    addEventListener('pagehide', flush)
    return () => {
      removeEventListener('visibilitychange', hide)
      removeEventListener('pagehide', flush)
    }
  }, [flush])

  /* ─────────── file-name badges for each textarea ─────────── */
  const emptyMap = FIELD_KEYS.reduce((m, k) => (m[k] = [], m), {})
  const [fileNames, setFileNames] = useState(emptyMap)

  /* reset the badge list if everything turns empty */
  useEffect(() => {
    const allEmpty = FIELD_KEYS.every(k => !form[k]) && !ctx
    if (allEmpty) setFileNames(emptyMap)
  }, [
    form.developGoal,
    form.developFeatures,
    form.developReturnFormat,
    form.developWarnings,
    ctx
  ])

  /* ─────────── drag-and-drop helpers ─────────── */
  function handleImage (name, url, revoke) {
    onImageDrop?.(prev => {
      if (prev.some(p => p.url === url)) {
        revoke()
        return prev
      }
      return [...prev, { name, url, revoke }]
    })
  }

  function makeDrop (key) {
    const { dragOver, drop } = useFileDrop(
      (txt, file) => {
        const block = `${file.name}\n\`\`\`\n${txt.trim()}\n\`\`\`\n`
        if (key === 'developContext') {
          setCtx(v => v + '\n\n' + block)
          bc.postMessage(ctx + '\n\n' + block)
        } else {
          setForm(f => ({
            ...f,
            [key]: (f[key] ? f[key] + '\n\n' : '') + block
          }))
        }
        setFileNames(f => ({ ...f, [key]: [...f[key], file.name] }))
      },
      handleImage
    )
    return { dragOver, drop }
  }
  const dropHandlers = {}
  FIELD_KEYS.concat('developContext').forEach(k => {
    dropHandlers[k] = makeDrop(k)
  })

  /* container-level drop for IMAGES only */
  const { dragOver: contOver, drop: contDrop } =
    useFileDrop(() => {}, handleImage)

  /* ─────────── SEND ─────────── */
  async function onSend () {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required')
      return
    }
    // copy latest context into form, persist, then call outer send
    setForm(f => ({ ...f, developContext: ctx }))
    await flush()
    handleSend()
  }

  /* ─────────── UI ─────────── */
  if (!loaded) return <p style={{ padding: '1rem' }}>Loading draft…</p>

  const fields = [
    ['GOAL',                        'developGoal',         2],
    ['FEATURES',                    'developFeatures',     2],
    ['RETURN FORMAT',               'developReturnFormat', 2],
    ['THINGS TO REMEMBER/WARNINGS', 'developWarnings',     2],
    ['CONTEXT',                     'developContext',      4]
  ]

  return (
    <div
      className="template-container"
      onDragOver={contOver}
      onDrop={contDrop}
    >
      {/* mode tabs */}
      <div className="mode-selector form-group">
        {['DEVELOP','COMMIT','CODE CHECK'].map(m => (
          <button
            key={m}
            className={mode === m ? 'button active' : 'button'}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {/* fields */}
      {mode === 'DEVELOP' && fields.map(([label, key, rows]) => {
        const isCtx  = key === 'developContext'
        const value  = isCtx ? ctx : form[key]
        const update = isCtx
          ? e => { const v=e.target.value; setCtx(v); bc.postMessage(v) }
          : e => setForm(f => ({ ...f, [key]: e.target.value }))

        return (
          <div key={key} className="form-group">
            <label>{label}:</label>
            <textarea
              rows={rows}
              className="form-textarea"
              value={value}
              onInput={update}
              onBlur={isCtx ? flush : undefined}
              onDragOver={dropHandlers[key].dragOver}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation()
                dropHandlers[key].drop(e)
              }}
            />
            {fileNames[key]?.length > 0 && (
              <div style={{ fontSize:'0.8rem', color:'#aaa', marginTop:4 }}>
                Files: {fileNames[key].join(', ')}
              </div>
            )}
          </div>
        )
      })}

      {/* file pane */}
      {mode === 'DEVELOP' && (
        <FilePane
          form={form}
          setForm={setForm}
          onPasteImage={(n,u,r) => handleImage(n,u,r)}
          onSkip={cnt =>
            showToast?.(`${cnt} non-text file${cnt>1?'s were':' was'} ignored`)
          }
        />
      )}

      {/* image previews */}
      {imagePreviews.length > 0 && (
        <div style={{
          display:'flex', flexWrap:'wrap', gap:8, margin:'8px 0'
        }}>
          {imagePreviews.map((img,i) => (
            <div key={i} style={{ position:'relative' }}>
              <img src={img.url} alt={img.name}
                   style={{ width:100, borderRadius:4 }} />
              <div
                style={{
                  position:'absolute', top:2, right:2,
                  width:20, height:20, borderRadius:'50%',
                  background:'rgba(0,0,0,0.6)', color:'#fff',
                  textAlign:'center', lineHeight:'20px',
                  cursor:'pointer'
                }}
                title="Remove image"
                onClick={() => { img.revoke?.(); onRemoveImage(i) }}
              >×</div>
              <div style={{
                fontSize:'0.7rem', color:'#ccc', textAlign:'center',
                width:100, overflow:'hidden', textOverflow:'ellipsis',
                whiteSpace:'nowrap', marginTop:2
              }}>{img.name}</div>
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
  )
}
