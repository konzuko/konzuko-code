// src/codeImporter/state.js

const generateId = () => crypto.randomUUID();

export function makeTopEntry(name, kind) { return { name, kind }; }

export function makeStagedFile(path, size, mime, text, insideProject, name) {
  return { id: generateId(), path, size, mime, text, insideProject, name };
}

export const initialState = { tag: 'IDLE' };

export function reducer(state, ev) {
  console.log('[Reducer] Current state:', state.tag, 'Event:', ev.type, ev);
  switch (ev.type) {
    case 'PICK_ROOT':
      if (state.tag === 'IDLE' || (state.root && state.root.name !== ev.handle.name) || state.tag === 'SCANNING' || (state.root && state.root.name === ev.handle.name) ) {
        return { tag: 'SCANNING', root: ev.handle };
      }
      console.warn('[Reducer] PICK_ROOT called but root is already set and not SCANNING. State unchanged or needs explicit rescan logic.');
      return state;

    case 'RESCAN_ROOT':
      if (state.root && (state.tag === 'FILTER' || state.tag === 'STAGED' || state.tag === 'IDLE')) {
        console.log('[Reducer] RESCAN_ROOT: Transitioning to SCANNING for root:', state.root.name);
        return { tag: 'SCANNING', root: state.root };
      }
      console.warn('[Reducer] RESCAN_ROOT called without a valid root or in an unexpected state.');
      return state;

    case 'SCAN_DONE':
      const rootForFilter = state.tag === 'SCANNING' ? state.root : null;
      if (!rootForFilter && ev.tops?.length > 0) {
          console.warn('[Reducer] SCAN_DONE received but no root in SCANNING state. Clearing.');
          return { tag: 'IDLE' };
      }
      return {
        tag     : 'FILTER',
        root    : rootForFilter,
        tops    : ev.tops || [],
        meta    : ev.meta || [], 
        selected: new Set()
      };

    case 'TOGGLE_SELECT': {
      if (state.tag !== 'FILTER') return state;
      const nextSelected = new Set(state.selected);
      if (ev.desiredState) nextSelected.add(ev.path);
      else nextSelected.delete(ev.path);
      return { ...state, selected: nextSelected };
    }

    case 'BULK_SELECT': {
        if (state.tag !== 'FILTER') return state;
        const nextSelected = new Set(state.selected);
        (ev.paths || []).forEach(path => {
            if (ev.select) nextSelected.add(path);
            else nextSelected.delete(path);
        });
        return { ...state, selected: nextSelected };
    }

    case 'BEGIN_STAGING':
      if (state.tag !== 'FILTER') return state;
      return {
        tag     : 'STAGING',
        root    : state.root,
        meta    : state.meta,
        selected: state.selected
      };

    case 'STAGING_DONE':
      const rootForStaged = state.tag === 'STAGING' ? state.root : null;
      return {
        tag  : 'STAGED',
        root : rootForStaged,
        files: ev.files || []
      };

    case 'FILES_ADDED': {
      const existingFiles = (state.tag === 'STAGED' && state.files) ? state.files : [];
      const newFiles = [...existingFiles, ...ev.files];
      return {
        tag: 'STAGED',
        root: state.root || null,
        files: newFiles
      };
    }
    
    case 'REMOVE_STAGED_FILE': {
        if (state.tag !== 'STAGED') return state;
        return {
            ...state,
            files: state.files.filter(f => f.id !== ev.id)
        };
    }

    case 'CLEAR_ALL':
      return { tag: 'IDLE' };

    default:
      return state;
  }
}
