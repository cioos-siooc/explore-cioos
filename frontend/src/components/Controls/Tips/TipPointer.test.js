import { describe, it, expect } from "vitest";

import { anchorCardStyle } from "./TipPointer.jsx";

const rect = (left, top, size = 30) => ({
  left,
  top,
  width: size,
  height: size,
  right: left + size,
  bottom: top + size,
});

describe("anchorCardStyle", () => {
  it("hangs the card below the hand for a control in the top half", () => {
    expect(anchorCardStyle(rect(500, 40), 1200, 800)).toEqual({
      left: 335,
      width: 360,
      top: 128,
    });
  });

  it("hangs the card above the hand for a control in the bottom half", () => {
    expect(anchorCardStyle(rect(500, 700), 1200, 800)).toEqual({
      left: 335,
      width: 360,
      bottom: 158,
    });
  });

  it("keeps the card on screen beside a control at either edge", () => {
    expect(anchorCardStyle(rect(0, 40), 1200, 800).left).toBe(12);
    expect(anchorCardStyle(rect(1170, 40), 1200, 800).left).toBe(828);
  });

  it("narrows the card to the screen on a phone", () => {
    expect(anchorCardStyle(rect(100, 40), 360, 700)).toMatchObject({
      left: 12,
      width: 336,
    });
  });
});
