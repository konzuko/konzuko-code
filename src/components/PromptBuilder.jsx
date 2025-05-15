/* --------------------------------------------------------------------
   PromptBuilder – single-blocks implementation
   • global 20 MB text cap
   • image blobs stay alive until App.jsx revokes them after Send
---------------------------------------------------------------------*/
import {
  useReducer, useMemo, useCallback,
  useState,   useEffect, useRef
} from 'preact/hooks';

import { useFileDrop }   from '../hooks.js';
import usePromptTokens   from '../hooks/usePromptTokens.js';
import {
  blockReducer, DEFAULT_TEXT_BLOCKS, BLOCK_TYPES,
  blocksToPrompt, fileToTextGuarded
} from '../promptBlocks.js';

import { isImage, isTextLike } from '../lib/fileTypeGuards.js';
import Toast from './Toast.jsx';

const GLOBAL_TEXT_LIMIT = 20 * 1024 * 1024;   // 20 MB

export default function PromptBuilder({ settings, handleSend, showToast }) {

  /* ─────────── state ─────────── */
  const [blocks, dispatch] = useReducer(blockReducer, DEFAULT_TEXT_BLOCKS);
  const [images, setImages] = useState([]);          // { name,url,revoke }

  /* keep latest images in a ref so unmount cleanup can revoke them */
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; });

  /* revoke blobs only when component unmounts */
  useEffect(() => () => {
    imagesRef.current.forEach(img => img.revoke?.());
  }, []);

  /* helper – global size guard */
  const wouldExceedGlobal = size =>
    blocks.reduce((n, b) => n + b.plainText.length, 0) + size > GLOBAL_TEXT_LIMIT;

  /* drag-and-drop handlers */
  const onTextFile = useCallback(async (txt, file) => {
    if (!isTextLike(file)) {
      showToast?.(`${file.name} skipped (binary or >400 KB)`);
      return;
    }
    if (wouldExceedGlobal(txt.length)) {
      showToast?.('Global 20 MB cap reached – file skipped');
      return;
    }
    dispatch({
      type   : 'add-file',
      name   : file.fullPath || file.name,
      content: txt
    });
  }, [showToast, blocks]);           // blocks for global-cap calc

  const onImage = useCallback((name, url, revoke) => {
    setImages(arr => [...arr, { name, url, revoke }]);
  }, []);

  const { dragOver, drop } = useFileDrop(onTextFile, onImage);

  /* token counter (2 s debounce) */
  const tokenBlocks = useMemo(
    () => blocks.map(b => ({ checksum: b.checksum, plainText: b.plainText })),
    [blocks]
  );
  const tokenCount = usePromptTokens(tokenBlocks, settings.model, 2000);

  /* manual file picker */
  const handleFilePicker = async () => {
    if (!window.showOpenFilePicker) { showToast?.('File picker unsupported'); return; }
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const h of handles) {
        const file = await h.getFile();

        if (isImage(file)) {
          const url    = URL.createObjectURL(file);
          const revoke = () => URL.revokeObjectURL(url);
          onImage(file.name, url, revoke);
          continue;
        }

        try {
          if (wouldExceedGlobal(file.size)) {
            showToast?.('Global 20 MB cap reached – file skipped');
            continue;
          }
          const txt = await fileToTextGuarded(file);
          dispatch({ type:'add-file', name:file.name, content:txt });
        } catch (err) {
          showToast?.(err.message);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  };

  /* SEND  */
  function onClickSend() {
    const prompt      = blocksToPrompt(blocks);
    /* pass the *original* image objects incl. revoke() to App */
    handleSend(prompt, images);

    /* UI reset (but no early revoke) */
    dispatch({ type:'reset-all' });
    setImages([]);                             // App will revoke later
  }

  /* UI */
  return (
    <div
      className="template-container"
      onDragOver={dragOver}
      onDrop={drop}
      style={{ overflowY:'auto' }}
    >
      <h2 style={{ marginBottom: 8 }}>Prompt Builder</h2>

      {blocks.map(b => (
        <div key={b.id} style={{ marginBottom: 12 }}>
          {b.type === BLOCK_TYPES.TEXT ? (
            <>
              <label htmlFor={b.id}>{b.label}</label>
              <textarea
                id={b.id}
                rows={b.rows}
                className="form-textarea"
                value={b.plainText}
                onInput={e =>
                  dispatch({ type:'edit-text', id:b.id, newText:e.target.value })
                }
              />
            </>
          ) : (
            <div
              style={{
                padding:'6px 8px', background:'#262626',
                border:'1px solid #444', borderRadius:4
              }}
            >
              {b.name}{' '}
              <small>({b.plainText.length.toLocaleString()} chars)</small>
            </div>
          )}

          <button
            className="button icon-button"
            aria-label="Remove block"
            onClick={() => dispatch({ type:'remove-block', id:b.id })}
            style={{ marginTop: 4 }}
          >
            ×
          </button>
        </div>
      ))}

      {/* image previews */}
      {images.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'8px 0' }}>
          {images.map((img,i) => (
            <div key={i} style={{ position:'relative' }}>
              <img src={img.url} alt={img.name}
                   style={{ width:100, borderRadius:4 }} />
              <button
                className="button icon-button"
                style={{
                  position:'absolute', top:2, right:2, padding:'0 4px'
                }}
                onClick={() => {
                  img.revoke?.();
                  setImages(arr => arr.filter((_,j) => j !== i));
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* footer */}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:12 }}>
        <button className="button" onClick={handleFilePicker}>+ Add Files</button>
        <div style={{ padding:'6px 12px', background:'#0f2540', borderRadius:4 }}>
          Tokens: {tokenCount.toLocaleString()}
        </div>
        <button className="button send-button" onClick={onClickSend}>
          Send
        </button>
      </div>
    </div>
  );
}