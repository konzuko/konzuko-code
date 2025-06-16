// file: src/hooks/usePromptBuilder.js
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { useFormData } from './useFormData.js';
import { useMode } from './useMode.js';
import { INITIAL_FORM_DATA } from './useFormData.js';
import { asciiTree } from '../lib/textUtils.js';

const safeTrim = (val) => (val ?? '').trim();

const AUTO_INPUT_STRING_FOR_RETURN_FORMAT = "If code is required, return the complete refactored code for the respective changed files in FULL with NO OMISSIONS so that i can paste it directly into my ide";
const PROMPT_SECTION_SEPARATOR = '\n\n';

function buildFormSection(currentForm, currentMode) {
  if (currentMode === 'DEVELOP') {
    const out = ['## MODE # DEVELOP'];

    if (safeTrim(currentForm.developGoal)) {
      out.push(`GOAL: ${safeTrim(currentForm.developGoal)}`);
    }
    if (safeTrim(currentForm.developFeatures)) {
      out.push(`REQUIREMENTS: ${safeTrim(currentForm.developFeatures)}`);
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
    return out.join('\n');
  }

  if (currentMode === 'COMMIT') {
    return (
      '## MODE # COMMIT\n' +
      'Identify if a commit has been made in this conversation yet or not. If ' +
      'it hasn\'t, Generate a git-style commit message for everything ' +
      'accomplished so far. If there is a prior commit, generate a commit ' +
      'message based on everything accomplished since that prior commit. Be ' +
      'HIGHLY DETAILED and COMPREHENSIVE to the extent an engineer not of ' +
      'the project can understand.'
    );
  }
  if (currentMode === 'CODE CHECK') {
    return (
      "## MODE # CODE CHECK\n" +
      "Apply your \"Code Auditing\" workflow to the following " +
      "1. ANALYSING THE CHANGES JUST MADE AND THEIR EFFECT ON THE WIDER CODEBASE, providing an audit report\n" +
      "IF THERE ARE NO ISSUES WITH THE LATEST CHANGES, or there were NONE, STATE SO EXPLICITY, THEN MOVE TO" +
      "2. ANALYSING THE ENTIRE UPTODATE CODEBASE AS A WHOLE, providing an audit report." +
      "\nReturn in order of High and Low Severity, provide specific findings, examples where possible, and explain the potential impact. For any cateogries you don't find any errors, just let us know that you don't find any errors at the end."
    );
  }
  return '';
}

function buildFilesSection(currentImportedCodeFiles) {
    if (!currentImportedCodeFiles || currentImportedCodeFiles.length === 0) return '';
    
    const out = [];
    
    const filesByRoot = new Map();
    currentImportedCodeFiles.forEach(file => {
        const rootName = file.rootName || 'INDIVIDUAL_FILES'; // Group individual files
        if (!filesByRoot.has(rootName)) {
            filesByRoot.set(rootName, []);
        }
        filesByRoot.get(rootName).push(file);
    });

    for (const [rootName, files] of filesByRoot.entries()) {
        if (rootName !== 'INDIVIDUAL_FILES') {
            const treePaths = files.map(f => f.path);
            out.push(`${rootName}/`);
            out.push(asciiTree(treePaths));
            out.push('');
        }
        
        files.forEach(f => {
            out.push('```yaml');
            out.push(`file: ${f.path}`);
            out.push('```');
            out.push('```');
            out.push(f.text);
            out.push('```');
        });
    }

    return out.join('\n');
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

  useEffect(() => {
    const imagesToRevoke = [...pendingImages];
    return () => { imagesToRevoke.forEach(revokeOnce); };
  }, [pendingImages]);

  const formText = useMemo(() => buildFormSection(form, mode), [form, mode]);
  const fileText = useMemo(() => buildFilesSection(importedCodeFiles), [importedCodeFiles]);

  const userPromptText = useMemo(() => {
    if (mode !== 'DEVELOP' || !fileText) {
        return formText;
    }
    return [formText, fileText].filter(Boolean).join(PROMPT_SECTION_SEPARATOR);
  }, [formText, fileText, mode]);


  const addPendingImage = useCallback(img => { setPendingImages(prev => [...prev, img]); }, []);
  const removePendingImage = useCallback(index => {
    setPendingImages(prev => { const img = prev[index]; if (img) revokeOnce(img); return prev.filter((_, i) => i !== index); });
  }, []);
  const addPendingPDF = useCallback(pdf => { setPendingPDFs(prev => [...prev, pdf]); }, []);

  const resetPrompt = useCallback(() => {
    setPendingImages([]);
    setPendingPDFs([]);
    // --- LOW SEVERITY FIX & CLARIFICATION ---
    // This function resets the form to its initial state, BUT it intentionally
    // preserves the user's preference for the 'developReturnFormat_autoIncludeDefault'
    // toggle. This provides a better user experience, as they don't have to
    // re-enable their preferred return format after every message.
    setForm(prevForm => ({
      ...INITIAL_FORM_DATA,
      developReturnFormat_autoIncludeDefault: prevForm.developReturnFormat_autoIncludeDefault,
    }));
  }, [setForm]);

  return {
    form, setForm, mode, setMode,
    pendingImages, addPendingImage, removePendingImage,
    pendingPDFs, addPendingPDF,
    formText,
    fileText,
    userPromptText,
    resetPrompt
  };
}
