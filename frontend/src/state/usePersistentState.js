import { useEffect, useState } from "react";

// The only place the app keeps anything in the browser. localStorage, not
// cookies, because none of this is the server's business; PrivacyModal
// describes what is kept, so a new key belongs there too. Best-effort:
// private-mode Safari and blocked storage throw, falling back to the default.
const PREFIX = "cde.";

function read(key, fallback) {
  try {
    const stored = window.localStorage.getItem(PREFIX + key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch (error) {
    console.warn(`could not read ${key} from localStorage:`, error);
    return fallback;
  }
}

function persist(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (error) {
    console.warn(`could not persist ${key} to localStorage:`, error);
  }
}

// Precedence: URL param, then stored value, then default. `parse` is the only
// thing between the query string and app state, so a junk param lands on the
// default.
export function useUrlSeededPersistentState(key, param, defaultValue, parse) {
  const [value, setValue] = useState(() => {
    const raw = new URL(window.location.href).searchParams.get(param);
    return raw === null ? read(key, defaultValue) : parse(raw);
  });

  useEffect(() => {
    persist(key, value);
  }, [key, value]);

  return [value, setValue];
}

// For preferences about the viewer rather than the map, which a share link
// has no business carrying.
export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(() => read(key, defaultValue));

  useEffect(() => {
    persist(key, value);
  }, [key, value]);

  return [value, setValue];
}

// Cookies earlier versions set, expired on load so the address stops
// travelling with every request.
const LEGACY_COOKIES = ["email", "introModalOpen", "i18next"];

export function clearLegacyCookies() {
  for (const name of LEGACY_COOKIES) {
    document.cookie = `${name}=; max-age=0`;
    document.cookie = `${name}=; max-age=0; path=/`;
  }
}
