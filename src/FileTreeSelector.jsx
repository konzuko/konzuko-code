// src/FileTreeSelector.jsx
import { useMemo } from 'preact/hooks'

/* Build a nested tree object from an array of paths */
function buildTree(paths) {
  const root = {}
  paths.forEach(p => {
    const parts = p.split('/').filter(Boolean)
    let cur = root
    parts.forEach((part, i) => {
      if (!cur[part]) cur[part] = i === parts.length - 1 ? null : {}
      cur = cur[part] || {}
    })
  })
  return root
}

/* Turn the same array into a pretty ASCII tree (used in prompt) */
export function asciiTree(paths) {
  const sort = [...paths].sort()
  const pad  = (lvl) => '│  '.repeat(lvl)
  let out = ''
  sort.forEach((p,i) => {
    const parts = p.split('/').filter(Boolean)
    parts.forEach((part, lvl) => {
      const key = parts.slice(0, lvl + 1).join('/')
      const prev = sort[i-1]?.startsWith(key + '/') ?? false
      if (lvl === parts.length - 1) {
        out += `${pad(lvl)}├─ ${part}\n`
      } else if (!prev) {
        out += `${pad(lvl)}${part}/\n`
      }
    })
  })
  return out.trimEnd()
}

/* Recursive render */
function Node({ name, node, fullPath, selected, toggle }) {
  const isDir = node !== null
  return (
    <div style={{ marginLeft: 12 }}>
      {!isDir && (
        <input
          type="checkbox"
          checked={selected.has(fullPath)}
          onChange={() => toggle(fullPath)}
          style={{ marginRight: 4 }}
        />
      )}
      <span style={{ fontWeight: isDir ? 'bold' : 'normal' }}>
        {name}{isDir && '/'}
      </span>
      {isDir &&
        Object.entries(node).map(([n, child]) => (
          <Node
            key={n}
            name={n}
            node={child}
            fullPath={`${fullPath}${n}/`}
            selected={selected}
            toggle={toggle}
          />
        ))}
    </div>
  )
}

/* Public component */
export default function FileTreeSelector({
  files,           // [{ path, selected }]
  onToggleSelect   // path => void
}) {
  const tree = useMemo(
    () => buildTree(files.map(f => f.path)),
    [files]
  )
  const selected = useMemo(
    () => new Set(files.filter(f => f.selected).map(f => f.path)),
    [files]
  )

  return (
    <div style={{
      maxHeight: 180, overflowY: 'auto',
      padding: 6, border: '1px solid var(--border)',
      borderRadius: 4, margin: '6px 0'
    }}>
      {Object.entries(tree).map(([name, node]) => (
        <Node
          key={name}
          name={name}
          node={node}
          fullPath={`${name}${node ? '/' : ''}`}
          selected={selected}
          toggle={onToggleSelect}
        />
      ))}
    </div>
  )
}