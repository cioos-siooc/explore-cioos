import { describe, it, expect } from "vitest";

import { server } from "./config.js";

// API_URL arrives two ways: vite's define{} rewrite (fed by .env.test) and a
// real process.env under Vitest's SSR transform, which doesn't rewrite it.
describe("the API base url", () => {
  it("is the unresolvable host from .env.test, not a real deployment", () => {
    // If this ever reads explore.cioos.ca, .env.test has stopped being picked up
    // and the suite is one un-stubbed fetch away from hitting production.
    expect(server).toBe("http://api.test/api");
  });

  it("is absolute, which the MapLibre tile worker requires", () => {
    // A relative API_URL works for main-thread fetch() but throws inside the
    // worker, where there is no document.baseURI to resolve against.
    expect(() => new URL(server)).not.toThrow();
  });
});
