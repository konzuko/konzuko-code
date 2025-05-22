// src/lib/domUtils.js

export const autoResizeTextarea = (textarea, maxHeight) => {
    if (textarea) {
      textarea.style.overflowY = 'hidden'; // Prevent scrollbar flash during calculation
      textarea.style.height = 'auto';    // Reset height to get accurate scrollHeight
  
      const computedStyle = getComputedStyle(textarea);
      const paddingTop = parseFloat(computedStyle.paddingTop);
      const paddingBottom = parseFloat(computedStyle.paddingBottom);
      const borderTop = parseFloat(computedStyle.borderTopWidth);
      const borderBottom = parseFloat(computedStyle.borderBottomWidth);
  
      const currentScrollHeight = textarea.scrollHeight;
  
      if (maxHeight && currentScrollHeight > maxHeight) {
        textarea.style.height = `${maxHeight}px`;
        textarea.style.overflowY = 'auto';
      } else {
        const minRows = parseInt(textarea.getAttribute('rows') || '1', 10);
        const lineHeight = parseFloat(computedStyle.lineHeight);
        const minHeightBasedOnRows = (minRows * lineHeight) + paddingTop + paddingBottom + borderTop + borderBottom;
  
        textarea.style.height = `${Math.max(currentScrollHeight, minHeightBasedOnRows)}px`;
        if (textarea.scrollHeight > parseFloat(textarea.style.height)) {
          textarea.style.overflowY = 'auto';
        } else {
          textarea.style.overflowY = 'hidden';
        }
      }
    }
  };
  