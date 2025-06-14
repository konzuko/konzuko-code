/* src/hooks/useUndoableDelete.js */
import { useCallback } from 'preact/hooks';

export function useUndoableDelete(showToast) {
  return useCallback(
    async ({ itemLabel, confirmMessage, deleteFn, undoFn, afterDelete }) => {
      const ok = confirm(
        confirmMessage ??
          `Delete this ${itemLabel.toLowerCase()}? You can undo for ~30 min.`
      );
      if (!ok) return;

      try {
        await deleteFn();
        afterDelete?.();
        showToast(`${itemLabel} deleted.`, 15000, undoFn); // Standardized duration
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    },
    [showToast]
  );
}
