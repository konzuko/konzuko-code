import { useMemo } from 'preact/hooks';
import { asciiTree } from '../lib/textUtils.js'; // Ensure this path is correct

// This internal version of buildUserPrompt is used by the hook
// to generate the text part derived from the form and pending files.
function buildUserPromptInternal(currentForm, currentMode, currentPendingFiles, projectRootName) {
    if (currentMode === 'DEVELOP') {
      const out = ['MODE: DEVELOP'];
      if (currentForm.developGoal.trim())         out.push(`GOAL: ${currentForm.developGoal.trim()}`);
      if (currentForm.developFeatures.trim())     out.push(`FEATURES: ${currentForm.developFeatures.trim()}`);
      if (currentForm.developReturnFormat.trim()) out.push(`RETURN FORMAT: ${currentForm.developReturnFormat.trim()}`);
      if (currentForm.developWarnings.trim())     out.push(`THINGS TO REMEMBER/WARNINGS: ${currentForm.developWarnings.trim()}`);
      if (currentForm.developContext.trim())      out.push(`CONTEXT: ${currentForm.developContext.trim()}`);

      const treePaths = currentPendingFiles.filter(f => f.insideProject).map(f => f.fullPath);
      
      // Only add projectRootName and file structure if a root is set AND there are files from that root
      if (projectRootName && treePaths.length > 0) {
        out.push(`${projectRootName}/`); // Project root name
        out.push(asciiTree(treePaths));  // Directly followed by the tree
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
    currentChatMessages, 
    formState,           
    currentMode,         
    currentPendingFiles, 
    currentPendingPDFs,  
    currentProjectRootName
) {
    return useMemo(() => {
        const itemsForApiCount = [];

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
                });
            });
        }

        const primaryUserText = buildUserPromptInternal(formState, currentMode, currentPendingFiles, currentProjectRootName);
        if (primaryUserText && String(primaryUserText).trim() !== "") {
            itemsForApiCount.push({ type: 'text', value: primaryUserText });
        }

        if (currentPendingPDFs && currentPendingPDFs.length > 0) {
            currentPendingPDFs.forEach(pdf => {
                itemsForApiCount.push({ type: 'pdf', uri: pdf.fileId, mimeType: pdf.mimeType });
            });
        }
        
        return itemsForApiCount;

    }, [currentChatMessages, formState, currentMode, currentPendingFiles, currentPendingPDFs, currentProjectRootName]);
}
