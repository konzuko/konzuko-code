/* -------------------------------------------------------------------------
   src/PromptBuilder.jsx
   “DEVELOP” fields, plus integrated file-drop area.
   Accepts text files → appended to text area,
             images   → a thumbnail,
   Also sets up the single “onSkip” toast if needed.
---------------------------------------------------------------------------*/

import { useState, useEffect } from 'preact/hooks';
import { useFileDrop }         from './hooks.js';
import FilePane                from './FilePane.jsx';

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
  const FIELD_KEYS = [
    'developGoal',
    'developFeatures',
    'developReturnFormat',
    'developWarnings',
    'developContext'
  ];
  const emptyMap = FIELD_KEYS.reduce((o, k) => (o[k] = [], o), {});
  const [fileNames, setFileNames] = useState(emptyMap);

  // If user clears all text fields, reset file-tag lists
  useEffect(() => {
    if (
      !form.developGoal &&
      !form.developFeatures &&
      !form.developReturnFormat &&
      !form.developWarnings &&
      !form.developContext
    ) {
      setFileNames(emptyMap);
    }
  }, [
    form.developGoal,
    form.developFeatures,
    form.developReturnFormat,
    form.developWarnings,
    form.developContext
  ]);

  // Dedupe images by url
  function handleImage(name, url, revoke) {
    onImageDrop?.((prev => {
      if (prev.some(x => x.url === url)) {
        revoke();
        return prev;
      }
      return [...prev, { name, url, revoke }];
    }));
  }

  // Build per-field drop handlers
  function makeDrop(key) {
    const { dragOver, drop } = useFileDrop(
      async (txt, file) => {
        const block = `${file.name}\n\`\`\`\n${txt.trim()}\n\`\`\`\n`;
        setForm(f => ({
          ...f,
          [key]: (f[key] ? f[key] + '\n\n' : '') + block
        }));
        setFileNames(f => ({
          ...f,
          [key]: [...f[key], file.name]
        }));
      },
      handleImage
    );
    return { dragOver, drop };
  }
  const dropHandlers = {};
  FIELD_KEYS.forEach(k => {
    dropHandlers[k] = makeDrop(k);
  });

  // Container-level drop zone for images
  const { dragOver: cOver, drop: cDrop } =
    useFileDrop(() => {/* ignore text */}, handleImage);

  // The text fields config
  const fields = [
    ['GOAL',                         'developGoal',         2],
    ['FEATURES',                     'developFeatures',     2],
    ['RETURN FORMAT',                'developReturnFormat', 2],
    ['THINGS TO REMEMBER/WARNINGS',  'developWarnings',     2],
    ['CONTEXT',                      'developContext',      3]
  ];

  return (
    <div
      className="template-container"
      onDragOver={cOver}
      onDrop={cDrop}
    >
      {/* Mode tabs */}
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

      {/* Show these fields if DEVELOP */}
      {mode === 'DEVELOP' && fields.map(([label, key, rows]) => (
        <div key={key} className="form-group">
          <label>{label}:</label>
          <textarea
            rows={rows}
            className="form-textarea"
            value={form[key]}
            onInput={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            onDragOver={dropHandlers[key].dragOver}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              dropHandlers[key].drop(e);
            }}
          />
          {fileNames[key].length > 0 && (
            <div style={{ fontSize:'0.8rem', color:'#aaa', marginTop:4 }}>
              Files: {fileNames[key].join(', ')}
            </div>
          )}
        </div>
      ))}

      {/* FilePane (skip toast usage) */}
      {mode === 'DEVELOP' && (
        <FilePane
          form={form}
          setForm={setForm}
          onPasteImage={(nm, url, rv) => handleImage(nm, url, rv)}
          onSkip={cnt =>
            showToast?.(
              `${cnt} non-text file${cnt>1?'s were':' was'} ignored.`
            )
          }
        />
      )}

      {/* Image previews */}
      {imagePreviews.length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', margin:'8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={i} style={{ position:'relative' }}>
              <img
                src={img.url}
                alt={img.name}
                style={{ width:100, borderRadius:4 }}
              />
              <div
                style={{
                  position:'absolute', top:2, right:2,
                  background:'rgba(0,0,0,0.6)', color:'#fff',
                  width:20, height:20, borderRadius:'50%',
                  textAlign:'center', lineHeight:'20px', cursor:'pointer'
                }}
                onClick={() => {
                  img.revoke?.();
                  onRemoveImage(i);
                }}
                title="Remove image"
              >
                ×
              </div>
              <div style={{
                fontSize:'0.7rem', color:'#ccc', textAlign:'center',
                marginTop:2, width:100, overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap'
              }}>
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Send button */}
      <button
        className="button send-button"
        disabled={loadingSend}
        onClick={handleSend}
      >
        {loadingSend ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
