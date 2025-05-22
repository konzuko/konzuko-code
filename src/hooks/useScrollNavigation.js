// src/hooks/useScrollNavigation.js
import { useRef, useCallback } from 'preact/hooks';

export function useScrollNavigation() {
  const scrollContainerRef = useRef(null);

  const scrollToPrev = useCallback(() => {
    const box = scrollContainerRef.current;
    if (!box) return;

    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;

    const viewportTop = box.scrollTop;
    let targetScroll = 0; // Default to scrolling to the very top

    // Find the last message that is fully or partially above the current viewport top
    for (let i = messagesInView.length - 1; i >= 0; i--) {
      const msg = messagesInView[i];
      // Check if the message's bottom is above or just at the viewport top,
      // or if its top is above the viewport top (for partially visible messages)
      if (msg.offsetTop + msg.offsetHeight < viewportTop + 10 || msg.offsetTop < viewportTop - 10) {
        targetScroll = msg.offsetTop;
        break;
      }
    }
    box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);

  const scrollToNext = useCallback(() => {
    const box = scrollContainerRef.current;
    if (!box) return;

    const viewportBottom = box.scrollTop + box.clientHeight;

    // If already near the bottom, scroll all the way to the bottom
    if (box.scrollHeight - viewportBottom < 50) {
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
      return;
    }

    const messagesInView = Array.from(box.querySelectorAll('.message'));
    if (!messagesInView.length) return;

    let targetScroll = box.scrollHeight; // Default to scrolling to the very bottom

    // Find the first message whose top is at or below the current viewport bottom
    for (let i = 0; i < messagesInView.length; i++) {
      const msg = messagesInView[i];
      if (msg.offsetTop >= viewportBottom - 10) { // -10 to catch messages just at the edge
        targetScroll = msg.offsetTop;
        break;
      }
    }
    box.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const box = scrollContainerRef.current;
    if (box) {
        box.scrollTo({ top: box.scrollHeight, behavior });
    }
  }, []);


  return {
    scrollContainerRef,
    scrollToPrev,
    scrollToNext,
    scrollToBottom,
  };
}
