import { describe, it, expect } from "vitest";

import { menuRoomFor } from "./VariablePicker.jsx";

const PHONE = { offsetTop: 0, height: 660 };

describe("menuRoomFor", () => {
  it("opens below a control with a full menu's room under it", () => {
    expect(menuRoomFor({ top: 100, bottom: 140 }, PHONE)).toEqual({
      placement: "bottom",
      height: 512,
    });
  });

  it("opens above a control near the bottom of the screen", () => {
    expect(menuRoomFor({ top: 500, bottom: 540 }, PHONE)).toEqual({
      placement: "top",
      height: 492,
    });
  });

  it("measures against what the keyboard leaves visible", () => {
    const keyboardUp = { offsetTop: 0, height: 380 };
    expect(menuRoomFor({ top: 300, bottom: 340 }, keyboardUp)).toEqual({
      placement: "top",
      height: 292,
    });
  });

  it("stays below when that side has the more room, however little", () => {
    expect(
      menuRoomFor({ top: 60, bottom: 100 }, { offsetTop: 0, height: 260 }),
    ).toEqual({ placement: "bottom", height: 152 });
  });
});
