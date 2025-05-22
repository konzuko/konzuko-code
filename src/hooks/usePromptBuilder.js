// src/hooks/usePromptBuilder.js
import { useState, useEffect, useCallback } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js'; // Corrected import path
import { asciiTree } from '../lib/textUtils.js';
// Toast is not used directly in this hook anymore, App.jsx handles toasts for send operations

// Moved from App.jsx
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
  if (currentMode === 'COMMIT') return 'MODE: COMMIT\nGenerate a git-style commit message for everything accomplished since last commit. If there was no previous commit, generate a commit message based on everything accomplished. Be detailed and comprehensive';
  if (currentMode === 'CODE CHECK') return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
  return '';
}

const revokeOnce = obj => { if (obj?.revoke) { obj.revoke(); obj.revoke = null; } };


export function usePromptBuilder() {
  const [form, setForm] = useFormData(); // Get setForm from useFormData
  const [mode, setMode] = useMode();   // Get setMode from useMode

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs, setPendingPDFs] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [currentProjectRootName, setCurrentProjectRootName] = useState(null);

  useEffect(() => {
    const imagesToRevokeOnUnmount = [...pendingImages];
    return () => {
      imagesToRevokeOnUnmount.forEach(revokeOnce);
    };
  }, []);

  const userPromptText = buildNewUserPromptText(form, mode, pendingFiles, currentProjectRootName);

  const addPendingImage = useCallback((img) => {
    setPendingImages(prev => [...prev, img]);
  }, []);

  const removePendingImage = useCallback((index) => {
    setPendingImages(prev => {
      const newImages = prev.filter((_, j) => j !== index);
      revokeOnce(prev[index]);
      return newImages;
    });
  }, []);

  const addPendingPDF = useCallback((pdf) => {
    setPendingPDFs(prev => [...prev, pdf]);
  }, []);

  const resetPrompt = useCallback(() => {
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]);
    // currentProjectRootName is reset via handleProjectRootChange(null) called by App.jsx on chat switch
    setForm(INITIAL_FORM_DATA);
  }, [pendingImages, setForm]);

  const handleProjectRootChange = useCallback((newRootName) => {
    setCurrentProjectRootName(newRootName);
    if (newRootName === null) {
        setPendingFiles(files => files.filter(f => !f.insideProject));
    }
  }, []);


  return {
    form,
    setForm, // Expose setForm from useFormData
    mode,
    setMode, // Expose setMode from useMode
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
