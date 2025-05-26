// src/hooks/usePromptBuilder.js

import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js';
import { asciiTree } from '../lib/textUtils.js';

const safeTrim = (val) => (val ?? '').trim();

// Helper to get raw text of pending files - NO LONGER NEEDED BY App.jsx
// function getRawPendingFilesText(currentPendingFiles) {
//   if (!currentPendingFiles || currentPendingFiles.length === 0) return "";
//   return currentPendingFiles.map(f => f.text).join('\n\n');
// }


function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles, projectRootName) {
  if (currentMode === 'DEVELOP') {
    const out = ['MODE: DEVELOP'];

    if (safeTrim(currentForm.developGoal)) {
      out.push(`GOAL ${safeTrim(currentForm.developGoal)}`);
    }
    if (safeTrim(currentForm.developFeatures)) {
      out.push(`FEATURES ${safeTrim(currentForm.developFeatures)}`);
    }
    if (safeTrim(currentForm.developReturnFormat)) {
      out.push(`RETURN FORMAT ${safeTrim(currentForm.developReturnFormat)}`);
    }
    if (safeTrim(currentForm.developWarnings)) {
      out.push(`THINGS TO REMEMBER/WARNINGS ${safeTrim(currentForm.developWarnings)}`);
    }

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
      '## MODE # COMMIT\n' +
      'Identify the last commit done in this chat, then identify everything ' +
      'accomplished since then. Generate a git-style commit message for ' +
      'everything accomplished. If there was no previous commit, generate ' +
      'a commit message based on everything accomplished since the beginning ' +
      'of this chat. Be detailed and comprehensive'
    );
  }

  if (currentMode === 'CODE CHECK') {
    return (
      '## MODE # CODE CHECK\n' +
      "Analyze the provided code (and relevant context from our conversation) for potential issues. Systematically check against each of the following categories:\n\n" +
      "1.  Logical Errors: Pinpoint flaws in the code's logic or if it deviates from intended behavior.\n" +
      "2.  Runtime Errors (Exceptions): Foresee potential crashes or exceptions during execution.\n" +
      "3.  Concurrency Issues: (If applicable) Detect race conditions, deadlocks, or other multi-threading/asynchronous problems.\n" +
      "4.  Semantic Errors: Check for incorrect use of language features or if the code's meaning is flawed.\n" +
      "5.  Performance Issues: Identify bottlenecks, inefficient algorithms, excessive resource usage, or areas for optimization.\n" +
      "6.  Security Issues: Uncover vulnerabilities such as injection, XSS, insecure data handling, auth/authz flaws, etc.\n" +
      "7.  Code Quality & Maintainability Issues: Evaluate clarity, readability, structure, complexity, adherence to best practices (naming, comments, DRY, SOLID principles if applicable).\n" +
      "\nReturn in order of High and Low Severity, provide specific findings, examples where possible, and explain the potential impact. For any cateogories you don't find errors, just let us know that you don't find any errors at the end."
    );
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
  }, []); 

  const userPromptText = useMemo(() => buildNewUserPromptText(
    form,
    mode,
    pendingFiles,
    currentProjectRootName
  ), [form, mode, pendingFiles, currentProjectRootName]);

  // rawPendingFilesConcatenatedText is no longer needed by App.jsx for token proportion
  // const rawPendingFilesConcatenatedText = useMemo(() => {
  //   return getRawPendingFilesText(pendingFiles);
  // }, [pendingFiles]);

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
      setPendingFiles(files => files.filter(f => !f.insideProject));
    }
  }, []);

  const resetPrompt = useCallback(() => {
    pendingImages.forEach(revokeOnce); 
    setPendingImages([]);
    setPendingPDFs([]);
    setPendingFiles([]); 
    setForm(INITIAL_FORM_DATA); 
  }, [pendingImages, setForm]); 

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
    // rawPendingFilesConcatenatedText, // No longer exporting this
    resetPrompt
  };
}
