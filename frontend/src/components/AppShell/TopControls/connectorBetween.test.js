import { describe, expect, it, vi } from "vitest";

import { connectorBetween } from "./ActiveFilterChips.jsx";

const inc = () => ({ excluded: false });
const exc = () => ({ excluded: true });

describe("connectorBetween", () => {
  it("is a fixed 'or' for a group with no match-all switch", () => {
    expect(connectorBetween({}, inc(), inc())).toEqual({ all: false });
  });

  it("is a fixed 'and' next to an excluded value", () => {
    const group = { match: { all: false, set: vi.fn() } };
    expect(connectorBetween(group, inc(), exc())).toEqual({ all: true });
  });

  it("follows and flips the group's switch", () => {
    const set = vi.fn();
    const c = connectorBetween({ match: { all: false, set } }, inc(), inc());
    expect(c.all).toBe(false);
    c.toggle();
    expect(set).toHaveBeenCalledWith(true);
  });
});
