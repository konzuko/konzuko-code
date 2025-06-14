/* src/codeImporter/state.js */
const generateId = () => crypto.randomUUID();

export function makeStagedFile(path, size, mime, text, insideProject, name, rootName) {
  return { id: generateId(), path, size, mime, text, insideProject, name, rootName, charCount: text.length };
}

// The state is now dramatically simplified. It only tracks the final list of staged files.
// All intermediate states (scanning, filtering) are handled by the component's local state and useQuery.
export const initialState = {
  files: [],
};

export function reducer(state, ev) {
  console.log('[Reducer] Event:', ev.type);
  switch (ev.type) {
    case 'ADD_FILES': {
      // This action now handles both project files and individual files.
      // If a root is provided, it means we are adding files from a project,
      // so we should replace any existing files from that same project.
      const otherFiles = ev.root
        ? state.files.filter(f => f.rootName !== ev.root.name)
        : state.files;

      const newFiles = ev.files || [];
      
      return {
        ...state,
        files: [...otherFiles, ...newFiles],
      };
    }
    
    case 'REMOVE_STAGED_FILE': {
      return {
        ...state,
        files: state.files.filter(f => f.id !== ev.id),
      };
    }

    case 'CLEAR_ALL':
      return { files: [] };

    default:
      return state;
  }
}
