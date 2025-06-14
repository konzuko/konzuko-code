/* src/codeImporter/state.js */
const generateId = () => crypto.randomUUID();

export function makeTopEntry(name, kind) { return { name, kind }; }

export function makeStagedFile(path, size, mime, text, insideProject, name, rootName) {
  return { id: generateId(), path, size, mime, text, insideProject, name, rootName, charCount: text.length };
}

export const initialState = { tag: 'IDLE' };

export function reducer(state, ev) {
  console.log('[Reducer] Current state:', state.tag, 'Event:', ev.type, ev);
  switch (ev.type) {
    case 'PICK_ROOT': {
      const existingFiles = state.tag === 'STAGED' ? state.files : [];
      return { tag: 'SCANNING', root: ev.handle, files: existingFiles };
    }

    case 'SCAN_DONE':
      if (state.tag === 'SCANNING') {
        return {
          tag: 'FILTER',
          root: state.root,
          tops: ev.tops || [],
          meta: ev.meta || [], 
          selected: new Set(),
          files: state.files || []
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
        return state;
    }

    case 'BEGIN_STAGING':
      if (state.tag === 'FILTER') {
        return {
          ...state,
          tag: 'STAGING',
        };
      }
      return state;

    case 'STAGING_DONE':
      if (state.tag === 'STAGING') {
        const existingFiles = state.files || [];
        const newFiles = ev.files || [];
        return {
          tag: 'STAGED',
          root: state.root,
          files: [...existingFiles, ...newFiles]
        };
      }
      return state;

    case 'FILES_ADDED': {
      const existingFiles = (state.tag === 'STAGED' && state.files) ? state.files : [];
      const newFiles = [...existingFiles, ...ev.files];
      return {
        ...state,
        tag: 'STAGED',
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
