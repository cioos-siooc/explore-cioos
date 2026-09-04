import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

import { installMatchMedia, resetViewport } from './viewport.js'

expect.extend(matchers)

// --- shims for the browser APIs this app uses and jsdom does not implement ---

// useMediaQuery.js (and through it UIProvider, Sidebar, Legend, the rails) calls
// window.matchMedia on first render. See ./viewport.js for the width it answers
// against and how a test changes it.
installMatchMedia()

// The rails measure themselves, and usePublishedFootprint reports panel sizes
// into CSS custom properties. Both observe; neither reads a real box in jsdom.
class NoopObserver {
  observe () {}
  unobserve () {}
  disconnect () {}
  takeRecords () {
    return []
  }
}
globalThis.ResizeObserver ??= NoopObserver
globalThis.IntersectionObserver ??= NoopObserver

// Node 26 defines its own experimental `localStorage` global, which shadows the
// one jsdom would otherwise install and is `undefined` unless node is started
// with --localstorage-file. usePersistentState reads window.localStorage
// directly, so without this every stored preference read throws.
if (!window.localStorage) {
  const store = new Map()
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length () {
      return store.size
    }
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true })
}

// Download flows hand a blob to the browser to save.
globalThis.URL.createObjectURL ??= () => 'blob:test'
globalThis.URL.revokeObjectURL ??= () => {}

// Anything that probes for a drawing context gets a clear "no" rather than a
// jsdom "not implemented" console error.
HTMLCanvasElement.prototype.getContext = () => null

// jsdom has no layout, so these are no-ops rather than errors.
Element.prototype.scrollTo ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// Vitest reuses one jsdom global for every test in a file, and this app writes
// to three pieces of shared browser state that would otherwise leak between
// them: the address (every provider seeds from window.location, and useUrlSync
// rewrites it), localStorage (usePersistentState's cde.* preferences) and
// document.cookie (UIProvider's introModalOpen, which decides whether the intro
// modal is on screen at all).
afterEach(() => {
  cleanup()
  resetViewport()
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0].trim()
    if (name) document.cookie = `${name}=; max-age=0; path=/`
  })
})
