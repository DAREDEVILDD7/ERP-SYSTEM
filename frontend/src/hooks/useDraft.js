import { useState, useEffect, useCallback } from 'react';

export function useDraft(key, initialValue) {
  const storageKey = `kw-ops-draft-${key}`;

  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (value && JSON.stringify(value) !== JSON.stringify(initialValue)) {
        localStorage.setItem(storageKey, JSON.stringify(value));
      }
    } catch {}
  }, [value, storageKey, initialValue]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setValue(initialValue);
  }, [storageKey, initialValue]);

  const hasDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return false;
      return JSON.stringify(JSON.parse(saved)) !== JSON.stringify(initialValue);
    } catch { return false; }
  }, [storageKey, initialValue]);

  return [value, setValue, clearDraft, hasDraft];
}