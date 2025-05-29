// src/hooks/usePromptBuilder.js

import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { useFormData, useMode, INITIAL_FORM_DATA } from '../hooks.js';
import { asciiTree } from '../lib/textUtils.js';

const safeTrim = (val) => (val ?? '').trim();

const AUTO_INPUT_STRING_FOR_RETURN_FORMAT = "return the complete refactored code for the respective changed files in FULL with NO OMISSIONS so that i can paste it directly into my ide";

function buildNewUserPromptText(currentForm, currentMode, currentPendingFiles, projectRootName) {
  if (currentMode === 'DEVELOP') {
    const out = ['## MODE # DEVELOP'];

    if (safeTrim(currentForm.developGoal)) {
      out.push(`GOAL: ${safeTrim(currentForm.developGoal)}`);
    }
    if (safeTrim(currentForm.developFeatures)) {
      out.push(`FEATURES: ${safeTrim(currentForm.developFeatures)}`);
    }

    // Construct the effective developReturnFormat
    let effectiveDevelopReturnFormat = safeTrim(currentForm.developReturnFormat_custom);
    if (currentForm.developReturnFormat_autoIncludeDefault) {
      if (effectiveDevelopReturnFormat === '') {
        effectiveDevelopReturnFormat = AUTO_INPUT_STRING_FOR_RETURN_FORMAT;
      } else {
        // Append with a newline if custom text exists
        effectiveDevelopReturnFormat = effectiveDevelopReturnFormat + '\n' + AUTO_INPUT_STRING_FOR_RETURN_FORMAT;
      }
    }

    if (effectiveDevelopReturnFormat) { // Only add if non-empty
      out.push(`RETURN FORMAT: ${effectiveDevelopReturnFormat}`);
    }

    if (safeTrim(currentForm.developWarnings)) {
      out.push(`THINGS TO REMEMBER/WARNINGS: ${safeTrim(currentForm.developWarnings)}`);
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
      // When the project root is cleared (e.g., by resetPrompt or user action in CodebaseImporter),
      // ensure any files that were associated with a project (insideProject: true)
      // are removed from the pendingFiles list. This maintains consistency.
      // If setPendingFiles([]) is called immediately before/after this, this specific
      // filter might operate on an already empty array, which is harmless.
      setPendingFiles(files => files.filter(f => !f.insideProject));
    }
  }, [setPendingFiles]); // setPendingFiles from useState is stable

  const resetPrompt = useCallback(() => {
    // Revoke URLs for any pending images to free up resources
    pendingImages.forEach(revokeOnce);
    setPendingImages([]);

    // Clear pending PDFs
    setPendingPDFs([]);

    // Clear the list of files intended for the next message.
    // This is crucial as it prevents sending the same files repeatedly
    // and ensures the token counter for the *next* message preparation starts fresh.
    setPendingFiles([]);

    // --- Implemented Change (April 2024) ---
    // Clear the project root context from CodebaseImporter.
    // Why this change?
    // 1. UI Consistency: After sending a message, the CodebaseImporter UI (project name,
    //    file/folder filter checkboxes) will also reset. This provides a cleaner visual slate,
    //    aligning with the fact that `pendingFiles` (the actual files to be sent) has been cleared.
    // 2. Reduced Confusion: While `setPendingFiles([])` already ensures the *next* message
    //    doesn't re-send old files (and thus the token count for the next message is accurate),
    //    leaving the old project root UI visible in CodebaseImporter could be confusing.
    //    Users might think those files are still implicitly selected or contributing to token counts.
    //    Clearing it makes the state unambiguous.
    // 3. Previous Behavior: Previously, only `pendingFiles` was cleared. The project root
    //    context in CodebaseImporter remained, allowing users to easily select *different* files
    //    from the same project for a subsequent message. While convenient for some iterative
    //    workflows, the consensus is that a full UI flush is preferable for clarity.
    // How it works:
    // - Calling `handleProjectRootChange(null)` sets `currentProjectRootName` to `null`.
    // - `CodebaseImporter.jsx` has a `useEffect` that listens to `currentProjectRootNameFromBuilder` (which is this `currentProjectRootName`).
    // - When `currentProjectRootNameFromBuilder` becomes `null`, that `useEffect` in `CodebaseImporter`
    //   resets its internal state (project root handle, filter UI, etc.) and clears the root from IDB.
    handleProjectRootChange(null);
    // --- End of Implemented Change ---

    // Reset form fields to their initial state, but preserve the
    // 'developReturnFormat_autoIncludeDefault' toggle state as it's a user preference
    // that should persist across prompt resets.
    setForm(prevForm => ({
      ...INITIAL_FORM_DATA,
      developReturnFormat_autoIncludeDefault: prevForm.developReturnFormat_autoIncludeDefault,
    }));
  }, [pendingImages, setForm, handleProjectRootChange]); // Added handleProjectRootChange to dependencies

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
    resetPrompt
  };
}

