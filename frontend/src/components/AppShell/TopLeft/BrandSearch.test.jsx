import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import BrandSearch from "./BrandSearch.jsx";

describe("BrandSearch", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // Asserted through map state: the toggle writes nothing of its own.
  function renderBrand(url = "/") {
    const seen = [];
    function Probe() {
      seen.push(useMapState().projection);
      return null;
    }
    const user = userEvent.setup();
    const { i18n } = renderWithProviders(
      <>
        <BrandSearch />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    return { user, seen, i18n };
  }

  it("flips the map projection, and names the projection it would flip to", async () => {
    const { user, seen } = renderBrand();

    expect(seen.at(-1)).toBe("mercator");
    await user.click(screen.getByTitle("Switch to globe view"));
    await waitFor(() => expect(seen.at(-1)).toBe("globe"));

    await user.click(screen.getByTitle("Switch to flat map view"));
    await waitFor(() => expect(seen.at(-1)).toBe("mercator"));
  });

  it("opens already flipped when the address asks for the globe", async () => {
    const { seen } = renderBrand("/?globe=true");

    expect(seen.at(-1)).toBe("globe");
    expect(screen.getByTitle("Switch to flat map view")).toBeInTheDocument();
  });

  it("goes solid-primary while the intro modal it opens is on screen", async () => {
    window.localStorage.setItem("cde.introSeen", "true");
    const { user } = renderBrand();

    const infoButton = screen.getByTitle("About this tool");
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(infoButton).not.toHaveClass("active");

    await user.click(infoButton);

    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(infoButton).toHaveClass("active");
  });

  it("links the logo out to the org's own English-language site", () => {
    renderBrand();
    expect(document.querySelector(".brandLogo")).toHaveAttribute(
      "href",
      "https://cioos.ca/",
    );
  });

  // The test i18n instance only loads English, so flip the language directly
  // (as IntroModal.test.jsx does) rather than via ?lang=.
  it("points the logo link at the French site once the language is French", async () => {
    const { i18n } = renderBrand();
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    expect(document.querySelector(".brandLogo")).toHaveAttribute(
      "href",
      "https://siooc.ca/",
    );
  });
});
