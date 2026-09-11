import * as React from "react";
import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import LanguageSelector from "./LanguageSelector.jsx";

describe("LanguageSelector", () => {
  it("shows the other language in uppercase", () => {
    renderWithProviders(<LanguageSelector />, { url: "/" });
    // i18n.languages always includes at least "en" — with no :lang route param
    // every configured language is "other", and .pop() takes the last one.
    const el = document.querySelector(".languageSelector");
    expect(el.textContent).toBe(el.textContent.toUpperCase());
    expect(el.textContent.length).toBeGreaterThan(0);
  });

  it("has the languageSelectorTitle tooltip", () => {
    renderWithProviders(<LanguageSelector />, { url: "/" });
    expect(document.querySelector(".languageSelector")).toHaveAttribute(
      "title",
      "Change language",
    );
  });

  it("clicking navigates with a lang param set to the other language", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSelector />, { url: "/?foo=bar" });
    await user.click(document.querySelector(".languageSelector"));
    const params = new URL(window.location.href).searchParams;
    expect(params.get("foo")).toBe("bar");
    expect(params.get("lang")).toBeTruthy();
  });

  it("prefixes the given className", () => {
    renderWithProviders(<LanguageSelector className="topBar" />, { url: "/" });
    expect(document.querySelector(".languageSelector")).toHaveClass("topBar");
  });
});
