// src/hooks/usePromptBuilder.js
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js';
import { asciiTree } from '../lib/textUtils.js';

// buildNewUserPromptText function remains here as it's logic related to the prompt.
function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles, projectRootName) {
  if (currentMode === 'DEVELOP') {
    const out = ['MODE: DEVELOP'];
    if (currentForm.developGoal.trim()) out.push(`GOAL: ${currentForm.developGoal.trim()}`);
    if (currentForm.developFeatures.trim()) out.push(`FEATURES: ${currentForm.developFeatures.trim()}`);
    if (currentForm.developReturnFormat.trim()) out.push(`RETURN FORMAT: ${currentForm.developReturnFormat.trim()}`);
    if (currentForm.developWarnings.trim()) out.push(`THINGS TO REMEMBER/WARNINGS: ${currentForm.developWarnings.trim()}`);
    if (currentForm.developContext.trim()) out.push(`CONTEXT: ${currentForm.developContext.trim()}`);

    const treePaths = currentPendingFiles.filter(f => f.insideProject).map(f => f.fullPath);
    if (projectRootName && treePaths.length > 0) {
      out.push(`${projectRootName}/`);
      out.push(asciiTree(treePaths));
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
  if (currentMode === 'COMMIT') return 'MODE: COMMIT\nIdentify the last commit done in this chat, then identify everything accomplished since then. Generate a git-style commit message for everything accomplished. If there was no previous commit, generate a commit message based on everything accomplished since the beginning of this chat. Be detailed and comprehensive';
  if (currentMode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
  return '';
}

const revokeOnce = obj => { if (obj?.revoke) { obj.revoke(); obj.revoke = null; } };

export function usePromptBuilder() {
  const [form, setForm] = useFormData();
  const [mode, setMode] = useMode();

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs, setPendingPDFs] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [currentProjectRootName, setCurrentProjectRootName] = useState(null);

  useEffect(() => {
    const imagesToRevokeOnUnmount = [...pendingImages];
    return () => {
      imagesToRevokeOnUnmount.forEach(revokeOnce);
    };
  }, []); // Removed pendingImages from dependency array as it causes re-runs clearing new images if not careful

  const userPromptText = buildNewUserPromptText(form, mode, pendingFiles, currentProjectRootName);

  const addPendingImage = useCallback((img) => {
    setPendingImages(prev => [...prev, img]);
  }, []);

  const removePendingImage = useCallback((index) => {
    setPendingImages(prev => {
      const imageToRevoke = prev[index];
      const newImages = prev.filter((_, j) => j !== index);
      if (imageToRevoke) { // Ensure imageToRevoke exists before calling revokeOnce
        revokeOnce(imageToRevoke);
      }
      return newImages;
    });
  }, []);

  const addPendingPDF = useCallback((pdf) => {
    setPendingPDFs(prev => [...prev, pdf]);
  }, []);

  const handleProjectRootChange = useCallback((newRootName) => {
    setCurrentProjectRootName(newRootName);
    if (newRootName === null) {
        // When project root is cleared, remove files that were part of that project
        setPendingFiles(files => files.filter(f => !f.insideProject));
    }
    // If newRootName is set, files are added/filtered by CodebaseImporter,
    // which then calls onFilesChange (setPendingFiles).
  }, [setCurrentProjectRootName, setPendingFiles]);


  const resetPrompt = useCallback(() => {
    // Revoke URLs for current pending images before clearing the array
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]); // Clears files from the builder's perspective
    setForm(INITIAL_FORM_DATA);
    handleProjectRootChange(null); // Signal to clear the project root concept
  }, [pendingImages, setForm, handleProjectRootChange, setPendingImages, setPendingPDFs, setPendingFiles]);


  return {
    form,
    setForm,
    mode,
    setMode,
    pendingImages,
    addPendingImage,
    removePendingImage,
    setPendingImages,
    pendingPDFs,
    addPendingPDF,
    setPendingPDFs,
    pendingFiles,
    setPendingFiles,
    currentProjectRootName,
    handleProjectRootChange,
    userPromptText,
    resetPrompt,
  };
}