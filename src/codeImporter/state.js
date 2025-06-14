/* src/codeImporter/state.js */
// src/codeImporter/state.js

const generateId = () => crypto.randomUUID();

export function makeTopEntry(name, kind) { return { name, kind }; }

export function makeStagedFile(path, size, mime, text, insideProject, name, rootName) {
  return { id: generateId(), path, size, mime, text, insideProject, name, rootName, charCount: text.length };
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

    case 'PICK_SECONDARY_ROOT':
        if (state.tag === 'STAGED') {
            return { ...state, tag: 'SCANNING_SECONDARY', secondaryRoot: ev.handle };
        }
        return state;

    case 'RESCAN_ROOT':
      if (state.root && (state.tag === 'FILTER' || state.tag === 'STAGED' || state.tag === 'IDLE')) {
        console.log('[Reducer] RESCAN_ROOT: Transitioning to SCANNING for root:', state.root.name);
        return { tag: 'SCANNING', root: state.root };
      }
      console.warn('[Reducer] RESCAN_ROOT called without a valid root or in an unexpected state.');
      return state;

    case 'SCAN_DONE':
      if (state.tag === 'SCANNING') {
        return {
          tag: 'FILTER',
          root: state.root,
          tops: ev.tops || [],
          meta: ev.meta || [], 
          selected: new Set()
        };
      }
      if (state.tag === 'SCANNING_SECONDARY') {
        return {
            ...state,
            tag: 'FILTER_SECONDARY',
            secondaryTops: ev.tops || [],
            secondaryMeta: ev.meta || [],
            secondarySelected: new Set()
        };
      }
      return state;

    case 'TOGGLE_SELECT': {
      if (state.tag === 'FILTER') {
        const nextSelected = new Set(state.selected);
        if (ev.desiredState) nextSelected.add(ev.path);
        else nextSelected.delete(ev.path);
        return { ...state, selected: nextSelected };
      }
      if (state.tag === 'FILTER_SECONDARY') {
        const nextSelected = new Set(state.secondarySelected);
        if (ev.desiredState) nextSelected.add(ev.path);
        else nextSelected.delete(ev.path);
        return { ...state, secondarySelected: nextSelected };
      }
      return state;
    }

    case 'BULK_SELECT': {
        if (state.tag === 'FILTER') {
            const nextSelected = new Set(state.selected);
            (ev.paths || []).forEach(path => {
                if (ev.select) nextSelected.add(path);
                else nextSelected.delete(path);
            });
            return { ...state, selected: nextSelected };
        }
        if (state.tag === 'FILTER_SECONDARY') {
            const nextSelected = new Set(state.secondarySelected);
            (ev.paths || []).forEach(path => {
                if (ev.select) nextSelected.add(path);
                else nextSelected.delete(path);
            });
            return { ...state, secondarySelected: nextSelected };
        }
        return state;
    }

    case 'BEGIN_STAGING':
      if (state.tag === 'FILTER') {
        return {
          tag: 'STAGING',
          root: state.root,
          meta: state.meta,
          selected: state.selected
        };
      }
      if (state.tag === 'FILTER_SECONDARY') {
        return {
            ...state,
            tag: 'STAGING_SECONDARY',
        };
      }
      return state;

    case 'STAGING_DONE':
      if (state.tag === 'STAGING') {
        return {
          tag: 'STAGED',
          root: state.root,
          files: ev.files || []
        };
      }
      if (state.tag === 'STAGING_SECONDARY') {
        const newFiles = [...state.files, ...ev.files];
        return {
            tag: 'STAGED',
            root: state.root,
            files: newFiles
        };
      }
      return state;

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
