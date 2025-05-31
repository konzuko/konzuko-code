/* src/PromptBuilder.jsx
   STAGE 2: Receives `importedCodeFiles` and `onCodeFilesChange` from App.jsx.
   `onCodeFilesChange` is passed to CodebaseImporter as `onFilesChange`.
*/
import { useEffect, useRef, useMemo } from 'preact/hooks';
// import { del } from 'idb-keyval'; // FIX: Removed obsolete del('devCtx')
import CodebaseImporter from './CodebaseImporter.jsx';
import { autoResizeTextarea } from './lib/domUtils.js';

const MAX_PROMPT_TEXTAREA_HEIGHT = 250;

export default function PromptBuilder({
  mode,
  setMode,
  form,
  setForm,
  sendDisabled,
  sendButtonText,
  handleSend,
  showToast,
  imagePreviews = [],
  pdfPreviews = [],
  onRemoveImage,
  onAddImage,
  onAddPDF,
  settings,
  hasLastSendFailed,
  importedCodeFiles,
  onCodeFilesChange,
  onProjectRootChange,
  promptBuilderRootName,
  currentChatId,
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

  // FIX: Removed obsolete del('devCtx') useEffect
  // useEffect(() => { del('devCtx').catch(() => {}); }, []);

  const fields = useMemo(
    () => [
      ['GOAL', 'developGoal', 2],
      ['FEATURES', 'developFeatures', 2],
      ['RETURN FORMAT', 'developReturnFormat_custom', 2],
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
        fields.map(([label, key, rows]) => {
          if (key === 'developReturnFormat_custom') {
            return ( /* ... (Return Format JSX unchanged) ... */
              <div key={key} className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label htmlFor={key} style={{ fontWeight: 'normal' }}>{label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.9em', color: 'var(--text-primary)', userSelect: 'none' }}>Complete Codeblocks</span>
                    <div
                      className={`visual-switch ${form.developReturnFormat_autoIncludeDefault ? 'is-on' : 'is-off'}`}
                      onClick={() => setForm(f => ({ ...f, developReturnFormat_autoIncludeDefault: !f.developReturnFormat_autoIncludeDefault }))}
                      role="switch"
                      aria-checked={form.developReturnFormat_autoIncludeDefault}
                      tabIndex={0}
                      onKeyPress={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setForm(f => ({ ...f, developReturnFormat_autoIncludeDefault: !f.developReturnFormat_autoIncludeDefault }));}}}
                      title={form.developReturnFormat_autoIncludeDefault
                              ? "ON: Auto-include instruction for full code blocks. Click or press Space/Enter to turn OFF."
                              : "OFF: Do not auto-include instruction for full code blocks. Click or press Space/Enter to turn ON."}
                    >
                      <div className="visual-switch-track">
                        <span className="visual-switch-text-on">ON</span>
                        <span className="visual-switch-text-off">OFF</span>
                      </div>
                      <div className="visual-switch-thumb"></div>
                    </div>
                  </div>
                </div>
                <textarea
                  id={key}
                  ref={(el) => (textareaRefs.current[key] = el)}
                  rows={rows}
                  className="form-textarea"
                  style={{ maxHeight: `${MAX_PROMPT_TEXTAREA_HEIGHT}px` }}
                  value={form[key]}
                  onInput={(e) => {
                    setForm((f) => ({ ...f, [key]: e.target.value }));
                    autoResizeTextarea(e.target, MAX_PROMPT_TEXTAREA_HEIGHT);
                  }}
                  placeholder="Add custom return format instructions here (optional)"
                />
              </div>
            );
          }
          return ( /* ... (Other fields JSX unchanged) ... */
            <div key={key} className="form-group">
              <label htmlFor={key}>{label}</label>
              <textarea
                id={key}
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
          );
        })}

      {mode === 'DEVELOP' && (
        <CodebaseImporter
          onFilesChange={onCodeFilesChange}
          toastFn={showToast}
          onAddImage={onAddImage}
          onAddPDF={onAddPDF}
          settings={settings}
          onProjectRootChange={onProjectRootChange}
          currentProjectRootNameFromBuilder={promptBuilderRootName}
        />
      )}

      {imagePreviews.length > 0 && ( /* ... (Image previews JSX unchanged) ... */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
          {imagePreviews.map((img, i) => (
            <div key={`${img.url}-${i}`} style={{ position: 'relative' }}>
              <img src={img.url} alt={img.name} style={{ width: 100, borderRadius: 4 }} />
              <div onClick={() => onRemoveImage(i)} title="Remove image" style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', color: '#fff', textAlign: 'center', lineHeight: '20px', cursor: 'pointer', }} > × </div>
              <div style={{ width: 100, marginTop: 2, fontSize: '0.7rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center', color: 'var(--text-secondary)', }} > {img.name} </div>
            </div>
          ))}
        </div>
      )}

      {pdfPreviews.length > 0 && ( /* ... (PDF previews JSX unchanged) ... */
        <div style={{ margin: '8px 0' }}>
          <strong>PDFs:</strong>
          <ul style={{ margin: '4px 0 0 16px', paddingLeft: 0, listStylePosition: 'inside', }} >
            {pdfPreviews.map((p, i) => ( <li key={`${p.fileId}-${i}`}>{p.name}</li> ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 'auto', paddingTop: 12, }} >
        <button className={`button send-button ${hasLastSendFailed && !sendDisabled ? 'send-button--error' : ''}`} disabled={sendDisabled} onClick={guardedSend} >
          {sendButtonText}
        </button>
      </div>
    </div>
  );
}
