/* -------------------------------------------------------------------------
   src/lib/textUtils.js
   Provides:
     • asciiTree()  – nested file paths → ASCII diagram
     • dedupe()     – remove duplicates by name|size|lastModified
---------------------------------------------------------------------------*/

export function asciiTree(paths = []) {
  const root = {};
  paths.forEach(p =>
    p.split('/').reduce((node, part, i, arr) => {
      node[part] ??= i === arr.length - 1 ? null : {};
      return node[part];
    }, root)
  );
  return renderTree(root, '');
}

function renderTree(node, prefix) {
  if (!node) return '';
  const keys = Object.keys(node).sort();
  return keys
    .map((k, i) => {
      const last = i === keys.length - 1;
      const kids = renderTree(node[k], prefix + (last ? '   ' : '│  '));
      return kids
        ? `${prefix}${last ? '└─ ' : '├─ '}${k}\n${kids}`
        : `${prefix}${last ? '└─ ' : '├─ '}${k}`;
    })
    .join('\n');
}

/**
 * Dedupe an array of File objects by “(name|size|lastModified)”.
 */
export function dedupe(files = []) {
  const seen = new Set();
  return files.filter(f => {
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}