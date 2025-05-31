// src/hooks/usePromptBuilder.js

import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js';
import { asciiTree } from '../lib/textUtils.js';

const safeTrim = (val) => (val ?? '').trim();

const AUTO_INPUT_STRING_FOR_RETURN_FORMAT = "return the complete refactored code for the respective changed files in FULL with NO OMISSIONS so that i can paste it directly into my ide";

function buildNewUserPromptText(currentForm, currentMode, currentImportedCodeFiles, projectRootName) {
  if (currentMode === 'DEVELOP') {
    const out = ['## MODE # DEVELOP'];

    if (safeTrim(currentForm.developGoal)) {
      out.push(`GOAL: ${safeTrim(currentForm.developGoal)}`);
    }
    if (safeTrim(currentForm.developFeatures)) {
      out.push(`FEATURES: ${safeTrim(currentForm.developFeatures)}`);
    }

    let effectiveDevelopReturnFormat = safeTrim(currentForm.developReturnFormat_custom);
    if (currentForm.developReturnFormat_autoIncludeDefault) {
      if (effectiveDevelopReturnFormat === '') {
        effectiveDevelopReturnFormat = AUTO_INPUT_STRING_FOR_RETURN_FORMAT;
      } else {
        effectiveDevelopReturnFormat = effectiveDevelopReturnFormat + '\n' + AUTO_INPUT_STRING_FOR_RETURN_FORMAT;
      }
    }

    if (effectiveDevelopReturnFormat) {
      out.push(`RETURN FORMAT: ${effectiveDevelopReturnFormat}`);
    }

    if (safeTrim(currentForm.developWarnings)) {
      out.push(`THINGS TO REMEMBER/WARNINGS: ${safeTrim(currentForm.developWarnings)}`);
    }

    const treePaths = (currentImportedCodeFiles || []).filter(f => f.insideProject).map(f => f.fullPath);
    if (projectRootName && treePaths.length > 0) {
      out.push(`${projectRootName}/`);
      out.push(asciiTree(treePaths));
    }

    (currentImportedCodeFiles || []).forEach(f => {
      out.push('```yaml');
      out.push(`file: ${f.fullPath}`);
      // if (f.note) out.push(`# ${f.note}`); // 'note' field not currently on StagedFile
      out.push('```');
      out.push('```');
      out.push(f.text);
      out.push('```');
    });

    return out.join('\n');
  }

  if (currentMode === 'COMMIT') { /* ... (unchanged) ... */
    return (
      '## MODE # COMMIT\n' +
      'Identify the last commit done in this chat, then identify everything ' +
      'accomplished since then. Generate a git-style commit message for ' +
      'everything accomplished. If there was no previous commit, generate ' +
      'a commit message based on everything accomplished since the beginning ' +
      'of this chat. Be detailed and comprehensive'
    );
  }
  if (currentMode === 'CODE CHECK') { /* ... (unchanged) ... */
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

export function usePromptBuilder(importedCodeFiles = []) {
  const [form, setForm] = useFormData();
  const [mode, setMode] = useMode();

  const [pendingImages, setPendingImages] = useState([]);
  const [pendingPDFs, setPendingPDFs] = useState([]);
  const [currentProjectRootName, setCurrentProjectRootName] = useState(null);

  useEffect(() => {
    const imagesToRevoke = [...pendingImages];
    return () => { imagesToRevoke.forEach(revokeOnce); };
  }, [pendingImages]);

  const userPromptText = useMemo(() => buildNewUserPromptText(
    form,
    mode,
    importedCodeFiles,
    currentProjectRootName
  ), [form, mode, importedCodeFiles, currentProjectRootName]);


  const addPendingImage = useCallback(img => { setPendingImages(prev => [...prev, img]); }, []);
  const removePendingImage = useCallback(index => {
    setPendingImages(prev => { const img = prev[index]; if (img) revokeOnce(img); return prev.filter((_, i) => i !== index); });
  }, []);
  const addPendingPDF = useCallback(pdf => { setPendingPDFs(prev => [...prev, pdf]); }, []);

  const handleProjectRootChange = useCallback(newRootName => {
    setCurrentProjectRootName(newRootName);
  }, []);

  const resetPrompt = useCallback(() => {
    setPendingImages([]);
    setPendingPDFs([]);
    handleProjectRootChange(null); // Signals CodebaseImporter (via App) to clear its root
    setForm(prevForm => ({
      ...INITIAL_FORM_DATA,
      developReturnFormat_autoIncludeDefault: prevForm.developReturnFormat_autoIncludeDefault,
    }));
  }, [setForm, handleProjectRootChange]);

  return {
    form, setForm, mode, setMode,
    pendingImages, addPendingImage, removePendingImage, // FIX: Removed setPendingImages
    pendingPDFs, addPendingPDF,                         // FIX: Removed setPendingPDFs
    currentProjectRootName,
    handleProjectRootChange,
    userPromptText,
    resetPrompt
  };
}
