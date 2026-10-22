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
