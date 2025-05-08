/* -------------------------------------------------------------------------
   src/PromptBuilder.jsx
   Handles the large DEVELOP fields + code textareas, plus an integrated
   file-drop area.  Now images dropped anywhere in the right-hand pane
   produce a thumbnail.  Text files get appended to whichever field the
   user is dragging onto.
---------------------------------------------------------------------------*/

import { useState, useEffect } from 'preact/hooks';
import { useFileDrop }         from './hooks.js';
import FilePane                from './FilePane.jsx';

export default function PromptBuilder({
  mode, setMode,
  form, setForm,
  loadingSend,
  handleSend,
  onImageDrop,
  onRemoveImage,
  imagePreviews
}) {
  // We track file names that got inserted into each text field
  const FIELD_KEYS = [
    'developGoal',
    'developFeatures',
    'developReturnFormat',
    'developWarnings',
    'developContext'
  ];
  const emptyMap = FIELD_KEYS.reduce((o, k) => (o[k] = [], o), {});
  const [fileNames, setFileNames] = useState(emptyMap);

  // If user cleared all fields, reset fileNames as well
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

  // For each text field, create a drop handler that appends triple-quoted code
  function makeDrop(key) {
    const { dragOver, drop } = useFileDrop(
      // If a text file
      async (text, file) => {
        const block = `${file.name}\n\`\`\`\n${text.trim()}\n\`\`\`\n`;
        setForm(f => ({
          ...f,
          [key]: (f[key] ? f[key] + '\n\n' : '') + block
        }));
        setFileNames(f => ({
          ...f,
          [key]: [...f[key], file.name]
        }));
      },
      // If an image
      onImageDrop
    );
    return { dragOver, drop };
  }

  // Build a dictionary of drop handlers keyed by field
  const dropHandlers = {};
  FIELD_KEYS.forEach(k => {
    dropHandlers[k] = makeDrop(k);
  });

  // Container-level drop for images: anywhere in the template column
  const { dragOver: containerOver, drop: containerDrop } = useFileDrop(
    () => { /* ignore text at container-level */ },
    onImageDrop
  );

  // The text field definitions
  const fields = [
    ['GOAL', 'developGoal', 2],
    ['FEATURES', 'developFeatures', 2],
    ['RETURN FORMAT', 'developReturnFormat', 2],
    ['THINGS TO REMEMBER/WARNINGS', 'developWarnings', 2],
    ['CONTEXT', 'developContext', 3]
  ];

  return (
    <div
      className="template-container"
      onDragOver={containerOver}
      onDrop={containerDrop}
    >
      {/* Mode tabs */}
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

      {/* Only show these fields if in DEVELOP mode */}
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
            <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: 4 }}>
              Files: {fileNames[key].join(', ')}
            </div>
          )}
        </div>
      ))}

      {/* Additional file drop UI (FilePane) */}
      {mode === 'DEVELOP' && (
        <FilePane
          form={form}
          setForm={setForm}
          onPasteImage={onImageDrop}
        />
      )}

      {/* Image previews */}
      {imagePreviews.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={img.url}
                alt={img.name}
                style={{ width: 100, borderRadius: 4 }}
              />
              <div
                style={{
                  position       : 'absolute',
                  top            : 2,
                  right          : 2,
                  background     : 'rgba(0,0,0,0.6)',
                  color          : '#fff',
                  width          : 20,
                  height         : 20,
                  borderRadius   : '50%',
                  textAlign      : 'center',
                  lineHeight     : '20px',
                  cursor         : 'pointer'
                }}
                onClick={() => onRemoveImage(i)}
                title="Remove image"
              >
                ×
              </div>
              <div style={{
                fontSize      : '0.7rem',
                color         : '#ccc',
                textAlign     : 'center',
                marginTop     : 2,
                width         : 100,
                overflow      : 'hidden',
                textOverflow  : 'ellipsis',
                whiteSpace    : 'nowrap'
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
