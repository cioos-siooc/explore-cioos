import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  noticeIcon,
  noticeStyle,
  noticeText,
  parseNotices,
} from "./notices.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const beta = { id: "beta", en: "Beta", fr: "Bêta" };

describe("parseNotices", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows nothing for anything but an array", () => {
    expect(parseNotices({ id: "beta", en: "Beta" }, NOW)).toEqual([]);
    expect(parseNotices(null, NOW)).toEqual([]);
  });

  it("keeps a notice with no expiry", () => {
    expect(parseNotices([beta], NOW)).toEqual([beta]);
  });

  it("drops a notice once its expiry has passed", () => {
    expect(
      parseNotices(
        [
          { ...beta, id: "past", expires: "2026-11-01" },
          { ...beta, id: "future", expires: "2026-12-01" },
        ],
        NOW,
      ).map(({ id }) => id),
    ).toEqual(["future"]);
  });

  it("holds a notice back until its start", () => {
    expect(
      parseNotices(
        [
          { ...beta, id: "later", starts: "2026-11-04" },
          { ...beta, id: "now", starts: "2026-11-03T12:00:00Z" },
          {
            ...beta,
            id: "window",
            starts: "2026-11-01",
            expires: "2026-12-01",
          },
        ],
        NOW,
      ).map(({ id }) => id),
    ).toEqual(["now", "window"]);
  });

  it("skips malformed entries but keeps the rest", () => {
    expect(
      parseNotices(
        [
          { en: "no id" },
          { id: "no-text" },
          { ...beta, id: "bad-date", expires: "soon" },
          { ...beta, id: "bad-start", starts: "later" },
          { ...beta, id: "bad-colour", background: "red" },
          { ...beta, id: "bad-icon", icon: "rocket" },
          { ...beta, id: "bad-css", css: { color: "red" } },
          { ...beta, id: "bad-tone", tone: "loud" },
          "text",
          beta,
        ],
        NOW,
      ),
    ).toEqual([beta]);
    expect(console.error).toHaveBeenCalledTimes(9);
  });
});

describe("noticeText", () => {
  it("reads the current language, falling back to English", () => {
    expect(noticeText(beta, "fr")).toBe("Bêta");
    expect(noticeText({ id: "x", en: "Only English" }, "fr")).toBe(
      "Only English",
    );
  });
});

describe("noticeStyle", () => {
  it("leaves the default face alone", () => {
    expect(noticeStyle(beta)).toBeUndefined();
  });

  it("puts navy text on a pale background and white on a dark one", () => {
    expect(noticeStyle({ ...beta, background: "#fdf3da" })).toMatchObject({
      "--notice-bg": "#fdf3da",
      "--notice-fg": "#152f37",
    });
    expect(noticeStyle({ ...beta, background: "#b3263a" })).toMatchObject({
      "--notice-fg": "#ffffff",
    });
    expect(noticeStyle({ ...beta, background: "#fff" })["--notice-fg"]).toBe(
      "#152f37",
    );
  });

  it("applies a notice's own css, over its background", () => {
    expect(
      noticeStyle({
        ...beta,
        background: "#152f37",
        css: "border-radius: 4px; border:2px solid #b07a00 ;--notice-bg: #fff; color: url(http://x)",
      }),
    ).toEqual({
      "--notice-bg": "#fff",
      "--notice-fg": "#ffffff",
      "--notice-link": "currentColor",
      borderRadius: "4px",
      border: "2px solid #b07a00",
      color: "url(http://x)",
    });
  });
});

describe("noticeIcon", () => {
  it("takes the notice's own icon, then its tone's, then the megaphone", () => {
    expect(noticeIcon({ ...beta, tone: "critical", icon: "event" })).toBe(
      "event",
    );
    expect(noticeIcon({ ...beta, tone: "critical" })).toBe("warning");
    expect(noticeIcon({ ...beta, tone: "info" })).toBe("info");
    expect(noticeIcon({ ...beta, icon: "none" })).toBe("none");
    expect(noticeIcon(beta)).toBe("megaphone");
  });

  it("accepts the three tones", () => {
    expect(
      parseNotices(
        ["info", "warning", "critical"].map((tone) => ({
          ...beta,
          id: tone,
          tone,
        })),
        NOW,
      ),
    ).toHaveLength(3);
  });
});
