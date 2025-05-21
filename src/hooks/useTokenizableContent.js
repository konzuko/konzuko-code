import { useMemo } from 'preact/hooks';
import { asciiTree } from '../lib/textUtils.js'; // Ensure this path is correct

// This internal version of buildUserPrompt is used by the hook
// to generate the text part derived from the form and pending files.
function buildUserPromptInternal(currentForm, currentMode, currentPendingFiles) {
    if (currentMode === 'DEVELOP') {
      const out = ['MODE: DEVELOP'];
      if (currentForm.developGoal.trim())         out.push(`GOAL: ${currentForm.developGoal.trim()}`);
      if (currentForm.developFeatures.trim())     out.push(`FEATURES: ${currentForm.developFeatures.trim()}`);
      if (currentForm.developReturnFormat.trim()) out.push(`RETURN FORMAT: ${currentForm.developReturnFormat.trim()}`);
      if (currentForm.developWarnings.trim())     out.push(`THINGS TO REMEMBER/WARNINGS: ${currentForm.developWarnings.trim()}`);
      if (currentForm.developContext.trim())      out.push(`CONTEXT: ${currentForm.developContext.trim()}`);

      const treePaths = currentPendingFiles.filter(f => f.insideProject).map(f => f.fullPath);
      if (treePaths.length) {
        out.push(`/* File structure:\n${asciiTree(treePaths)}\n*/`);
      }
      currentPendingFiles.forEach(f => {
        out.push('```yaml');
        out.push(`file: ${f.fullPath}`);
        if (f.note) out.push(`# ${f.note}`);
        out.push('```');
        out.push('```');
        out.push(f.text);
        out.push('```');
      });
      return out.join('\n');
    }
    if (currentMode === 'COMMIT') return 'MODE: COMMIT\nGenerate a git-style commit message for everything accomplished since last commit. If there was no previous commit, generate a commit message based on everything accomplished. Be detailed and comprehensive';
    if (currentMode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
    return '';
}


export function useTokenizableContent(
    currentChatMessages, // Array of messages from the current chat
    formState,           // The `form` object from PromptBuilder
    currentMode,         // Current mode ('DEVELOP', 'COMMIT', etc.)
    currentPendingFiles, // Array of pending text files
    currentPendingPDFs   // Array of pending PDF objects { fileId, mimeType, name }
) {
    return useMemo(() => {
        // console.log('[useTokenizableContent] Recalculating itemsForApiCount...'); // Optional: for debugging the hook
        const itemsForApiCount = [];

        // 1. Process text and PDF URIs from currentChatMessages
        if (currentChatMessages && currentChatMessages.length > 0) {
            currentChatMessages.forEach(msg => {
                const contentBlocks = Array.isArray(msg.content)
                    ? msg.content
                    : [{ type: 'text', text: String(msg.content ?? '') }];

                contentBlocks.forEach(block => {
                    if (block.type === 'text' && block.text && String(block.text).trim() !== "") {
                        itemsForApiCount.push({ type: 'text', value: block.text });
                    } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type && block.file.mime_type.includes('pdf')) {
                        itemsForApiCount.push({ type: 'pdf', uri: block.file.file_id, mimeType: block.file.mime_type });
                    }
                    // Images in history are handled by estimation in App.jsx's total count calculation
                });
            });
        }

        // 2. Process text from new prompt (using formState, currentMode, currentPendingFiles)
        const primaryUserText = buildUserPromptInternal(formState, currentMode, currentPendingFiles);
        if (primaryUserText && String(primaryUserText).trim() !== "") {
            itemsForApiCount.push({ type: 'text', value: primaryUserText });
        }

        // 3. Process new pending PDFs
        if (currentPendingPDFs && currentPendingPDFs.length > 0) {
            currentPendingPDFs.forEach(pdf => {
                itemsForApiCount.push({ type: 'pdf', uri: pdf.fileId, mimeType: pdf.mimeType });
            });
        }
        
        return itemsForApiCount;

    }, [currentChatMessages, formState, currentMode, currentPendingFiles, currentPendingPDFs]);
}
