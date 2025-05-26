/* src/PromptBuilder.jsx
   - Accepts currentChatId, sendDisabled, and sendButtonText props.
   - Uses sendDisabled for button disable state.
   - Uses sendButtonText for the button's dynamic text.
*/
import { useEffect, useRef, useMemo } from 'preact/hooks'; // Removed useState as local buttonText logic is gone
import { del } from 'idb-keyval';
import CodebaseImporter from './CodebaseImporter.jsx';
import { autoResizeTextarea } from './lib/domUtils.js';

const MAX_PROMPT_TEXTAREA_HEIGHT = 250; // px

export default function PromptBuilder({
  mode,
  setMode,

  form,
  setForm,

  sendDisabled,     // Receives the computed disabled state from App.jsx
  sendButtonText,   // Receives the computed button text from App.jsx
  handleSend,
  showToast,

  imagePreviews = [],
  pdfPreviews = [],
  onRemoveImage,

  onAddImage,
  onAddPDF,

  settings, // Still needed for CodebaseImporter

  pendingFiles,
  onFilesChange,
  onProjectRootChange,
  promptBuilderRootName,

  currentChatId, // Still needed for CodebaseImporter (potentially) or other internal logic if any
}) {
  const formRef = useRef(form);
  const textareaRefs = useRef({});

  useEffect(() => {
    formRef.current = form;
  }, [form]);

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

  useEffect(() => {
    del('devCtx').catch(() => {});
  }, []);

  const fields = useMemo(
    () => [
      ['GOAL', 'developGoal', 2],
      ['FEATURES', 'developFeatures', 2],
      ['RETURN FORMAT', 'developReturnFormat', 2],
      ['THINGS TO REMEMBER/WARNINGS', 'developWarnings', 2],
    ],
    []
  );

  useEffect(() => {
    if (mode === 'DEVELOP') {
      fields.forEach(([, key]) => {
        const node = textareaRefs.current[key];
        if (node) autoResizeTextarea(node, MAX_PROMPT_TEXTAREA_HEIGHT);
      });
    }
  }, [form, fields, mode]);

  function guardedSend() {
    if (mode === 'DEVELOP' && !form.developGoal.trim()) {
      showToast?.('GOAL is required', 3000);
      return;
    }
    handleSend();
  }

  // Removed local buttonText useMemo, as it's now passed as a prop 'sendButtonText'

  return (
    <div className="template-container">
      <div className="mode-selector form-group">
        {['DEVELOP', 'CODE CHECK', 'COMMIT'].map((m) => (
          <button
            key={m}
            className={mode === m ? 'button active' : 'button'}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'DEVELOP' &&
        fields.map(([label, key, rows]) => (
          <div key={key} className="form-group">
            <label>{label}:</label>
            <textarea
              ref={(el) => (textareaRefs.current[key] = el)}
              rows={rows}
              className="form-textarea"
              style={{ maxHeight: `${MAX_PROMPT_TEXTAREA_HEIGHT}px` }}
              value={form[key]}
              onInput={(e) => {
                setForm((f) => ({ ...f, [key]: e.target.value }));
                autoResizeTextarea(e.target, MAX_PROMPT_TEXTAREA_HEIGHT);
              }}
            />
          </div>
        ))}

      {mode === 'DEVELOP' && (
        <CodebaseImporter
          files={pendingFiles}
          onFilesChange={onFilesChange}
          toastFn={showToast}
          onAddImage={onAddImage}
          onAddPDF={onAddPDF}
          settings={settings}
          onProjectRootChange={onProjectRootChange}
          currentProjectRootNameFromBuilder={promptBuilderRootName}
        />
      )}

      {imagePreviews.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={`${img.url}-${i}`} style={{ position: 'relative' }}>
              <img
                src={img.url}
                alt={img.name}
                style={{ width: 100, borderRadius: 4 }}
              />
              <div
                onClick={() => onRemoveImage(i)}
                title="Remove image"
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  textAlign: 'center',
                  lineHeight: '20px',
                  cursor: 'pointer',
                }}
              >
                ×
              </div>
              <div
                style={{
                  width: 100,
                  marginTop: 2,
                  fontSize: '0.7rem',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {pdfPreviews.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          <strong>PDFs:</strong>
          <ul
            style={{
              margin: '4px 0 0 16px',
              paddingLeft: 0,
              listStylePosition: 'inside',
            }}
          >
            {pdfPreviews.map((p, i) => (
              <li key={`${p.fileId}-${i}`}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 'auto',
          paddingTop: 12,
        }}
      >
        <button
          className="button send-button"
          disabled={sendDisabled} // Use the prop passed from App.jsx
          onClick={guardedSend}
        >
          {sendButtonText} {/* Use the prop passed from App.jsx */}
        </button>
      </div>
    </div>
  );
}
