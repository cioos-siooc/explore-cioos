import { useEffect, useState } from "react";

// useState for a UI preference the user sets once and expects to find again (the
// map's layer switches, the projection, what the hex ramp counts), kept under a
// single namespace in localStorage — and overridable by the share link the app
// was opened at.
//
// Storage is best-effort: private-mode Safari and blocked third-party storage
// both throw on access, and a preference is never worth crashing the app over,
// so failures fall back to the in-memory default.
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

// Precedence on load: the URL param if the link carries one, then the stored
// value, then the default. UrlSync writes the param back whenever the value is
// not the default, so a copied link reproduces the map it was copied from while
// a bare URL still opens on whatever the user last chose.
//
// `parse` turns the raw param into the state's own type, and is the only thing
// standing between the query string and the app's state: the boolean switches
// read 'false'/'true', and the projection maps `globe=true` onto its two named
// values. So the link says what the user sees rather than naming internal
// state, and a junk param lands on the default instead of somewhere unexpected.
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

// For the preferences that describe the viewer rather than the map (which tips
// they have already seen, whether they want tips at all), so a share link has
// no business carrying them.
export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(() => read(key, defaultValue));

  useEffect(() => {
    persist(key, value);
  }, [key, value]);

  return [value, setValue];
}
