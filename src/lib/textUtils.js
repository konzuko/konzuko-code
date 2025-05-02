/* -------------------------------------------------------------------------
   src/lib/textUtils.js
   Shared text-helper utilities (asciiTree, dedupe, …)
---------------------------------------------------------------------------*/

/**
 * Build an ASCII tree from an array of file paths.
 * Example input:
 *   ['src/App.jsx', 'src/utils/index.js', 'package.json']
 *
 * Example output:
 *   ├─ package.json
 *   └─ src
 *      ├─ App.jsx
 *      └─ utils
 *         └─ index.js
 *
 * The algorithm first builds a nested object representation, then
 * recursively renders it with box-drawing characters.
 */
export function asciiTree(paths = []) {
    const root = {};
  
    // Build nested object { dir: { file: null } }
    paths.forEach(p =>
      p.split('/').reduce((node, part, i, arr) => {
        node[part] ??= i === arr.length - 1 ? null : {};
        return node[part];
      }, root)
    );
  
    // Recursively stringify
    return renderTree(root, '');
  }
  
  function renderTree(node, prefix) {
    if (!node) return '';
    const keys = Object.keys(node).sort();
  
    return keys
      .map((k, i) => {
        const isLast = i === keys.length - 1;
        const line   = `${prefix}${isLast ? '└─ ' : '├─ '}${k}`;
        const kids   = renderTree(node[k], prefix + (isLast ? '   ' : '│  '));
        return kids ? `${line}\n${kids}` : line;
      })
      .join('\n');
  }
  
  /**
   * Dedupe an array of File objects by their `.fullPath` property.
   * Keeps the first occurrence of each unique path.
   */
  export function dedupe(files = []) {
    const seen = new Set();
    return files.filter(f => {
      if (seen.has(f.fullPath)) return false;
      seen.add(f.fullPath);
      return true;
    });
  }