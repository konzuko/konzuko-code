import { useState, useEffect, useCallback } from 'preact/hooks'
import { useFileDrop }                    from './hooks.js'
import FilePane                           from './FilePane.jsx'

export default function PromptBuilder({
  mode, setMode,
  form, setForm,
  loadingSend, editingId,
  handleSend,
  // We receive handleCopyAll here (still used if we want, but button is relocated)
  handleCopyAll,
  onImageDrop,
  onRemoveImage,
  imagePreviews
}) {
  // file‐name lists per text field
  const FIELD_KEYS = [
    'developGoal',
    'developFeatures',
    'developReturnFormat',
    'developWarnings',
    'developContext'
  ]
  const initialFiles = FIELD_KEYS.reduce((o,k)=>(o[k]=[],o),{})
  const [fileNames, setFileNames] = useState(initialFiles)

  // Clear fileNames when form is reset
  useEffect(() => {
    if (
      !form.developGoal &&
      !form.developFeatures &&
      !form.developReturnFormat &&
      !form.developWarnings &&
      !form.developContext
    ) {
      setFileNames(initialFiles)
    }
  }, [
    form.developGoal,
    form.developFeatures,
    form.developReturnFormat,
    form.developWarnings,
    form.developContext
  ])

  // For each text field, build a drag+drop object to handle multiple files
  const makeDrop = fieldKey => {
    const { dragOver, drop } = useFileDrop((text, file) => {
      const header = `/* content of ${file.name} */\n\n`
      setForm(f => ({
        ...f,
        [fieldKey]: f[fieldKey] + '\n\n' + header + text
      }))
      setFileNames(f => ({
        ...f,
        [fieldKey]: [...f[fieldKey], file.name]
      }))
    })
    return { dragOver, drop }
  }
  const dropGoal     = makeDrop('developGoal')
  const dropFeatures = makeDrop('developFeatures')
  const dropReturn   = makeDrop('developReturnFormat')
  const dropWarns    = makeDrop('developWarnings')
  const dropContext  = makeDrop('developContext')

  // Container-level image drop
  const onDragOverImg = useCallback(e=>e.preventDefault(),[])
  const onDropImg     = useCallback(e=>{
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file||!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = ()=>onImageDrop(file.name, reader.result)
    reader.readAsDataURL(file)
  },[onImageDrop])

  const fields = [
    ['GOAL','developGoal',2],
    ['FEATURES','developFeatures',2],
    ['RETURN FORMAT','developReturnFormat',2],
    ['THINGS TO REMEMBER/WARNINGS','developWarnings',2],
    ['CONTEXT','developContext',3]
  ]

  return (
    <div
      className="template-container"
      onDragOver={onDragOverImg}
      onDrop={onDropImg}
    >
      <div className="mode-selector form-group">
        {['DEVELOP','COMMIT','CODE CHECK'].map(m=>(
          <button
            key={m}
            className={mode===m?'button active':'button'}
            onClick={()=>setMode(m)}
          >{m}</button>
        ))}
      </div>

      {mode==='DEVELOP' && fields.map(([label,key,rows])=>(
        <div key={key} className="form-group">
          <label>{label}:</label>
          <textarea
            rows={rows}
            className="form-textarea"
            value={form[key]}
            onInput={e=>setForm(f=>({...f,[key]:e.target.value}))}
            onDragOver={dropContext.dragOver /* fallback; see override below */}
            onDrop={e=>{
              e.stopPropagation()
              // Route the drop to the correct text area
              if (key==='developGoal')            dropGoal.drop(e)
              if (key==='developFeatures')        dropFeatures.drop(e)
              if (key==='developReturnFormat')    dropReturn.drop(e)
              if (key==='developWarnings')        dropWarns.drop(e)
              if (key==='developContext')         dropContext.drop(e)
            }}
          />
          {fileNames[key].length>0 && (
            <div style={{fontSize:'0.8rem',color:'#aaa',marginTop:4}}>
              Files: {fileNames[key].join(', ')}
            </div>
          )}
        </div>
      ))}

      {/* Insert the FilePane right under the CONTEXT field */}
      {mode==='DEVELOP' && (
        <FilePane
          form={form}
          setForm={setForm}
          onPasteImage={onImageDrop}
        />
      )}

      {/* Thumbnails for any pasted or dropped images */}
      {imagePreviews.length>0 && (
        <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'8px 0'}}>
          {imagePreviews.map((img,i)=>(
            <div key={i} style={{position:'relative'}}>
              <img
                src={img.url}
                alt={img.name}
                style={{width:100,borderRadius:4}}
              />
              <div style={{
                position:'absolute',
                top:2,right:2,
                background:'rgba(0,0,0,0.6)',
                color:'#fff',
                borderRadius:'50%',
                width:20,height:20,
                textAlign:'center',
                lineHeight:'20px',
                cursor:'pointer'
              }}
                onClick={()=>onRemoveImage(i)}
                title="Remove image"
              >×</div>
              <div style={{
                fontSize:'0.7rem',
                color:'#ccc',
                textAlign:'center',
                marginTop:2,
                width:100,
                overflow:'hidden',
                textOverflow:'ellipsis',
                whiteSpace:'nowrap'
              }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Removed the "Copy All Text" button from here */}
      <button
        className="button send-button"
        disabled={loadingSend}
        onClick={handleSend}
      >
        {loadingSend ? 'Sending…' : (editingId ? 'Update' : 'Send')}
      </button>
    </div>
  )
}