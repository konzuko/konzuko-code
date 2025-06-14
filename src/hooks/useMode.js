/* src/hooks/useMode.js */
import { useState, useEffect } from 'preact/hooks';
import { LOCALSTORAGE_MODE_KEY } from '../config.js';

export function useMode() {
  const ALLOWED = ['DEVELOP', 'COMMIT', 'CODE CHECK'];
  const stored  = localStorage.getItem(LOCALSTORAGE_MODE_KEY);
  const initial = ALLOWED.includes(stored) ? stored : 'DEVELOP';
  const [mode, _setMode] = useState(initial);

  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_MODE_KEY, mode);
  }, [mode]);

  const setMode = val => ALLOWED.includes(val) && _setMode(val);
  return [mode, setMode];
}
