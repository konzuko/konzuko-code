
// src/PromptBuilder.jsx
import { useState }               from 'preact/hooks'
import { useFileDrop }            from './hooks.js'

export default function PromptBuilder({
  mode, setMode,
  form, setForm,
  loadingSend, editingId,
  handleSend, handleCopyAll
}) {
  // track text-file names
  const [includedFiles, setIncludedFiles] = useState([])
  // track image previews
  const [imagePreviews, setImagePreviews] = useState([])

  // build a drop-handler for each textarea
  const dropFor = (fieldKey) => (text, file) => {
    // inject a header comment + file contents
    const headered = `/* content of ${file.name} */\n\n${text}`
    setForm(f => ({ ...f, [fieldKey]: headered }))
    setIncludedFiles(list =>
      Array.from(new Set([...list, file.name]))
    )
  }

  // instantiate five text-drop hooks
  const dropGoal     = useFileDrop(dropFor('developGoal'))
  const dropFeatures = useFileDrop(dropFor('developFeatures'))
  const dropReturn   = useFileDrop(dropFor('developReturnFormat'))
  const dropWarns    = useFileDrop(dropFor('developWarnings'))
  const dropContext  = useFileDrop(dropFor('developContext'))

  const handlers = {
    developGoal        : dropGoal,
    developFeatures    : dropFeatures,
    developReturnFormat: dropReturn,
    developWarnings    : dropWarns,
    developContext     : dropContext
  }

  // container-level image drop
  const handleImageDragOver = e => e.preventDefault()
  const handleImageDrop = e => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      setImagePreviews(imgs => [
        ...imgs,
        { name: file.name, url: reader.result }
      ])
    }
    reader.readAsDataURL(file)
  }

  // form rows
  const fields = [
    ['GOAL',          'developGoal',         2],
    ['FEATURES',      'developFeatures',     2],
    ['RETURN FORMAT', 'developReturnFormat', 2],
    ['WARNINGS',      'developWarnings',     2],
    ['CONTEXT',       'developContext',      3]
  ]

  return (
    <div
      className="template-container"
      onDragOver={handleImageDragOver}
      onDrop={handleImageDrop}
    >
      <div className="mode-selector form-group">
        {['DEVELOP','COMMIT','DIAGNOSE'].map(m => (
          <button
            key={m}
            className={mode === m ? 'button active' : 'button'}
            onClick={() => setMode(m)}
          >{m}</button>
        ))}
      </div>

      {mode === 'DEVELOP' && fields.map(([label, key, rows]) => (
        <div key={key} className="form-group">
          <label>{label}:</label>
          <textarea
            rows={rows}
            className="form-textarea"
            value={form[key]}
            onInput={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            onDragOver={handlers[key].dragOver}
            onDrop={e => {
              e.stopPropagation()
              handlers[key].drop(e)
            }}
          />
        </div>
      ))}

      {includedFiles.length > 0 && (
        <div style={{
          marginTop:'var(--space-md)',
          fontSize:'0.8rem',
          color:'var(--text-secondary)'
        }}>
          Included files: {includedFiles.join(', ')}
        </div>
      )}

      {imagePreviews.length > 0 && (
        <div style={{
          marginTop:'var(--space-md)',
          display:'flex', gap:'8px', flexWrap:'wrap'
        }}>
          {imagePreviews.map((img, i) => (
            <div key={i} style={{ textAlign:'center' }}>
              <img
                src={img.url}
                alt={img.name}
                style={{ width:100, height:'auto', borderRadius:4 }}
              />
              <div style={{ fontSize:'0.7rem', marginTop:'4px' }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        className="button send-button"
        disabled={loadingSend}
        onClick={handleSend}
      >
        {loadingSend ? 'Sending…' : editingId ? 'Update' : 'Send'}
      </button>

      <button
        className="button"
        style={{ marginTop:'8px' }}
        onClick={handleCopyAll}
      >
        Copy All Text
      </button>
    </div>
  )
}