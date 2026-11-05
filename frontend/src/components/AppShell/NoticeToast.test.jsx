import * as React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { Notice } from "./NoticeToast.jsx";
import { NOTICE_ICONS } from "../../state/notices/notices.js";

describe("Notice", () => {
  it.each(NOTICE_ICONS.filter((icon) => icon !== "none"))(
    "draws the %s icon",
    (icon) => {
      const { container } = render(
        <Notice notice={{ id: "beta", en: "Beta", icon }} />,
      );
      expect(container.querySelector(".noticeIcon svg")).not.toBeNull();
    },
  );

  it("draws no icon for none", () => {
    const { container } = render(
      <Notice notice={{ id: "beta", en: "Beta", icon: "none" }} />,
    );
    expect(container.querySelector(".noticeIcon")).toBeNull();
  });
});
