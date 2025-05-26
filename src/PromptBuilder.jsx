/* src/PromptBuilder.jsx
   - Accepts currentChatId prop.
   - Uses sendDisabled for button disable state.
   - Dynamically sets button text based on states.
*/
import { useEffect, useRef, useMemo } from 'preact/hooks';
import { del } from 'idb-keyval';
import CodebaseImporter from './CodebaseImporter.jsx';
import { autoResizeTextarea } from './lib/domUtils.js';

const MAX_PROMPT_TEXTAREA_HEIGHT = 250; // px

export default function PromptBuilder({
  mode,
  setMode,

  form,
  setForm,

  sendDisabled, // This prop now correctly reflects if the send button should be disabled
  handleSend,
  showToast,

  imagePreviews = [],
  pdfPreviews = [],
  onRemoveImage,

  onAddImage,
  onAddPDF,

  settings,

  pendingFiles,
  onFilesChange,
  onProjectRootChange,
  promptBuilderRootName,

  currentChatId, // Added prop to receive currentChatId
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

  // Determine button text based on various states
  // Note: App.jsx's `sendButtonDisabled` includes `isSendingMessage`, `isSavingEdit`, `isResendingMessage`, `isHardTokenLimitReached`.
  // We need more granular info from App.jsx if we want "Saving..." or "Resending..." text.
  // For now, this logic tries to infer based on what `sendDisabled` implies.
  const buttonText = useMemo(() => {
    // If sendDisabled is true, it could be for multiple reasons.
    // The most specific reasons (API key, chat ID) should take precedence for the message
    // if they are the cause of `sendDisabled` (though `sendDisabled` itself doesn't directly reflect these).
    // This logic is a bit of a workaround because PromptBuilder doesn't know *why* sendDisabled is true.
    // Ideally, App.jsx would pass a more specific `sendButtonContext` or individual loading flags.

    if (!settings.apiKey) return 'Set API Key'; // This check is independent of sendDisabled
    if (!currentChatId) return 'Select Chat';   // This check is independent of sendDisabled
    
    // If sendDisabled is true, it implies either a hard token limit or an ongoing operation.
    // We can't distinguish between "Sending...", "Saving...", "Resending..." from just `sendDisabled`.
    // So, "Processing..." is a generic term if disabled for reasons other than API key/chat ID.
    if (sendDisabled) return 'Processing…'; 
    
    return 'Send';
  }, [sendDisabled, settings.apiKey, currentChatId]);

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
          disabled={sendDisabled}
          onClick={guardedSend}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
