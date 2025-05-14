// FNV-1a 32-bit – single canonical copy
export function checksum32(str = '') {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h = (h ^ str.charCodeAt(i)) * 0x01000193 >>> 0;
    }
    return h;
  }
  