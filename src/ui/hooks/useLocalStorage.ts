import { useCallback, useEffect, useState } from "react";

function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  const item = localStorage.getItem(key);
  if (item === null) return defaultValue;
  if (item === "undefined") return undefined as T;
  try {
    return JSON.parse(item) as T;
  } catch {
    return defaultValue;
  }
}

/** Buzzar: "storage" events only reach other tabs; this tells this tab's other users of the same key. */
const SAME_TAB_EVENT = "buzzar-local-storage";

export type setLocalStorageItem<T> = (value: T | ((previousValue: T) => T)) => void;

export function useLocalStorage<T>(key: string, defaultValue: T): [T, setLocalStorageItem<T>] {
  const [storedValue, setStoredValue] = useState(() => getLocalStorageItem(key, defaultValue));

  useEffect(() => {
    const handleStorageChange = (evt: StorageEvent) => {
      if (evt.key !== key) return;
      setStoredValue(getLocalStorageItem(key, defaultValue));
    };

    const handleSameTabChange = (evt: Event) => {
      if ((evt as CustomEvent<string>).detail !== key) return;
      setStoredValue(getLocalStorageItem(key, defaultValue));
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(SAME_TAB_EVENT, handleSameTabChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(SAME_TAB_EVENT, handleSameTabChange);
    };
  }, [key, defaultValue]);

  const setValue = useCallback(
    (value: T | ((previousValue: T) => T)) => {
      try {
        const item = value instanceof Function ? value(getLocalStorageItem(key, defaultValue)) : value;
        localStorage.setItem(key, JSON.stringify(item));
        setStoredValue(item);
        window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: key }));
      } catch (err) {
        console.warn(`Error setting local storage! key: ${key}`, err);
      }
    },
    [key, defaultValue]
  );

  return [storedValue, setValue];
}
