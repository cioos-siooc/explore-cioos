import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

import { installMatchMedia, resetViewport } from "./viewport.js";

expect.extend(matchers);

// Shims for browser APIs jsdom does not implement.

installMatchMedia();

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver ??= NoopObserver;
globalThis.IntersectionObserver ??= NoopObserver;

// Node 26's experimental `localStorage` global shadows jsdom's and is
// `undefined` unless node is started with --localstorage-file.
if (!window.localStorage) {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: storage,
    configurable: true,
  });
}

globalThis.URL.createObjectURL ??= () => "blob:test";
globalThis.URL.revokeObjectURL ??= () => {};

// A clear "no" rather than jsdom's "not implemented" console error.
HTMLCanvasElement.prototype.getContext = () => null;

Element.prototype.scrollTo ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// Vitest reuses one jsdom global per file; the address, localStorage and
// cookies would otherwise leak between tests.
afterEach(() => {
  cleanup();
  resetViewport();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  document.cookie.split(";").forEach((entry) => {
    const name = entry.split("=")[0].trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  });
});
