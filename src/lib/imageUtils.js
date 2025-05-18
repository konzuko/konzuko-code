/* ------------------------------------------------------------------
   compressImageToWebP(file, shortSide = 1024, quality = 0.85)

   • Fast path with OffscreenCanvas.convertToBlob (Chrome 86+)
   • Robust feature-detect, no per-call object leak
   • DOM-canvas fallback for any missing feature
-------------------------------------------------------------------*/
const OFFSCREEN_SUPPORTED = (() => {
    try {
      if (typeof OffscreenCanvas === 'undefined') return false;
      const oc = new OffscreenCanvas(1, 1);
      return typeof oc.convertToBlob === 'function';
    } catch {
      return false;
    }
  })();
  
  export async function compressImageToWebP(
    file,
    shortSide = 1024,
    quality   = 0.85
  ) {
    const bmp   = await createImageBitmap(file);
    const scale = Math.min(1, shortSide / Math.min(bmp.width, bmp.height));
    const w     = Math.round(bmp.width  * scale);
    const h     = Math.round(bmp.height * scale);
  
    let blob;
    if (OFFSCREEN_SUPPORTED) {
      const oc  = new OffscreenCanvas(w, h);
      const ctx = oc.getContext('2d', { alpha: false });
      ctx.drawImage(bmp, 0, 0, w, h);
      blob = await oc.convertToBlob({ type: 'image/webp', quality });
    } else {
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      cvs.getContext('2d', { alpha: false }).drawImage(bmp, 0, 0, w, h);
      blob = await new Promise(res => cvs.toBlob(res, 'image/webp', quality));
    }
  
    bmp.close?.();
    return blob;
  }
  