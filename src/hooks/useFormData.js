/* src/hooks/useFormData.js */
import { useState, useEffect } from 'preact/hooks';
import { LOCALSTORAGE_DEBOUNCE, LOCALSTORAGE_FORM_KEY } from '../config.js';

export const INITIAL_FORM_DATA = {
  developGoal: '',
  developFeatures: '',
  developReturnFormat_custom: '',
  developReturnFormat_autoIncludeDefault: true,
  developWarnings: '',
  fixCode: '',
  fixErrors: ''
};

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function useDebouncedLocalStorage(key, initial, delay = LOCALSTORAGE_DEBOUNCE) {
  const [value, setValue] = useState(() => {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue !== null) {
        const parsed = JSON.parse(storedValue);
        return deepMerge(initial, parsed);
      }
      return initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.warn('localStorage error:', err);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [key, value, delay]);

  return [value, setValue];
}

export function useFormData() {
  return useDebouncedLocalStorage(LOCALSTORAGE_FORM_KEY, INITIAL_FORM_DATA);
}
