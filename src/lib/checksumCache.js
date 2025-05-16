// src/lib/checksumCache.js
import { checksum32 } from './checksum.js';

/*
  WeakMap-based checksum cache
  • Keeps React message objects immutable.
  • Entry is GC-collected automatically when the message is gone.
*/

const ckMap = new WeakMap();

/* helper: flatten array-of-blocks → plain text */
function flatten(content) {
  if (Array.isArray(content)) {
    return content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  }
  return String(content ?? '');
}

/**
 * getChecksum(msg)
 * Returns an FNV-1a 32-bit checksum for the message’s text content.
 * Result is cached per–message via WeakMap.
 */
export function getChecksum(msg) {
  let ck = ckMap.get(msg);
  if (ck != null) return ck;

  ck = checksum32(flatten(msg.content));
  ckMap.set(msg, ck);
  return ck;
}

/**
 * invalidateChecksum(msg) – optional helper if you mutate a message’s
 * content in-place and need to force a recalc.
 */
export function invalidateChecksum(msg) {
  ckMap.delete(msg);
}