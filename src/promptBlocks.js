import { checksum32 } from './lib/checksum.js';
import { MAX_TEXT_FILE_SIZE, isTextLike } from './lib/fileTypeGuards.js';

export const BLOCK_TYPES = { TEXT:'text', FILE:'file' };
export const FILE_LIMIT  = 500;

/* default text areas */
export const DEFAULT_TEXT_BLOCKS = [
  { label:'GOAL',           rows:2 },
  { label:'FEATURES',       rows:2 },
  { label:'RETURN FORMAT',  rows:2 },
  { label:'WARNINGS',       rows:2 },
  { label:'CONTEXT',        rows:4 }
].map(({ label, rows }) => ({
  id       : crypto.randomUUID(),
  type     : BLOCK_TYPES.TEXT,
  label,
  rows,
  plainText: '',
  checksum : 0
}));

export function blockReducer(state, action) {
  switch (action.type) {
    case 'edit-text':
      return state.map(b =>
        b.id === action.id
          ? { ...b, plainText: action.newText, checksum: checksum32(action.newText) }
          : b
      );

    case 'add-file': {
      if (state.filter(b => b.type === BLOCK_TYPES.FILE).length >= FILE_LIMIT)
        return state;
      const { name, content } = action;
      const ck = checksum32(content);
      if (state.some(b => b.type === BLOCK_TYPES.FILE && b.name === name && b.checksum === ck))
        return state;
      return [
        ...state,
        { id: crypto.randomUUID(), type: BLOCK_TYPES.FILE, name, plainText: content, checksum: ck }
      ];
    }

    case 'remove-block':
      return state.filter(b => b.id !== action.id);

    case 'reset-all':
      return DEFAULT_TEXT_BLOCKS;

    default:
      return state;
  }
}

export function blocksToPrompt(blocks) {
  return blocks
    .map(b =>
      b.type === BLOCK_TYPES.TEXT
        ? `${b.label}:\n${b.plainText}`
        : `/* ${b.name} */\n${b.plainText}`
    )
    .join('\n\n');
}

export async function fileToTextGuarded(file) {
  if (!isTextLike(file))
    throw new Error(`${file.name} skipped (binary or wrong type)`);
  if (file.size > MAX_TEXT_FILE_SIZE)
    throw new Error(`${file.name} > ${Math.round(MAX_TEXT_FILE_SIZE / 1024)} KB`);
  return file.text();
}