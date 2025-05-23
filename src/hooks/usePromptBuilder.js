// src/hooks/usePromptBuilder.js

import { useState, useEffect, useCallback } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js';
import { asciiTree } from '../lib/textUtils.js';

const safeTrim = (val) => (val ?? '').trim();

function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles, projectRootName) {
  if (currentMode === 'DEVELOP') {
    const out = ['MODE: DEVELOP'];

    if (safeTrim(currentForm.developGoal)) {
      out.push(`GOAL: ${safeTrim(currentForm.developGoal)}`);
    }
    if (safeTrim(currentForm.developFeatures)) {
      out.push(`FEATURES: ${safeTrim(currentForm.developFeatures)}`);
    }
    if (safeTrim(currentForm.developReturnFormat)) {
      out.push(`RETURN FORMAT: ${safeTrim(currentForm.developReturnFormat)}`);
    }
    if (safeTrim(currentForm.developWarnings)) {
      out.push(`THINGS TO REMEMBER/WARNINGS: ${safeTrim(currentForm.developWarnings)}`);
    }
    // Removed CONTEXT section
    // if (safeTrim(currentForm.developContext)) {
    //   out.push(`CONTEXT: ${safeTrim(currentForm.developContext)}`);
    // }

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

  if (currentMode === 'COMMIT') {
    return (
      'MODE: COMMIT\n' +
      'Identify the last commit done in this chat, then identify everything ' +
      'accomplished since then. Generate a git-style commit message for ' +
      'everything accomplished. If there was no previous commit, generate ' +
      'a commit message based on everything accomplished since the beginning ' +
      'of this chat. Be detailed and comprehensive'
    );
  }

  if (currentMode === 'CODE CHECK') {
    return 'MODE: CODE CHECK\nPlease analyze any errors or pitfalls.';
  }

  return '';
}

const revokeOnce = obj => {
  if (obj?.revoke) {
    obj.revoke();
    obj.revoke = null;
  }
};

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
  }, []); // Removed pendingImages from dependency array as it causes re-runs and premature revocations

  const userPromptText = buildNewUserPromptText(
    form,
    mode,
    pendingFiles,
    currentProjectRootName
  );

  const addPendingImage = useCallback(img => {
    setPendingImages(prev => [...prev, img]);
  }, []);

  const removePendingImage = useCallback(index => {
    setPendingImages(prev => {
      const img = prev[index];
      if (img) revokeOnce(img);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const addPendingPDF = useCallback(pdf => {
    setPendingPDFs(prev => [...prev, pdf]);
  }, []);

  const handleProjectRootChange = useCallback(newRootName => {
    setCurrentProjectRootName(newRootName);
    if (newRootName === null) {
      // When project root is cleared, remove files that were part of that project
      setPendingFiles(files => files.filter(f => !f.insideProject));
    }
  }, []);

  const resetPrompt = useCallback(() => {
    pendingImages.forEach(revokeOnce); // Revoke any existing images
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]); // Clear text files
    setForm(INITIAL_FORM_DATA); // Reset form fields to their initial state
    handleProjectRootChange(null); // Reset project root concept
  }, [pendingImages, setForm, handleProjectRootChange]); // Added pendingImages to deps for revokeOnce

  return {
    form,
    setForm,
    mode,
    setMode,
    pendingImages,
    addPendingImage,
    removePendingImage,
    setPendingImages, // Keep this if direct setting is needed elsewhere, though usually add/remove are preferred
    pendingPDFs,
    addPendingPDF,
    setPendingPDFs, // Keep for similar reasons
    pendingFiles,
    setPendingFiles,
    currentProjectRootName,
    handleProjectRootChange,
    userPromptText,
    resetPrompt
  };
}

