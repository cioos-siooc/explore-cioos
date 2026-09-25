import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import PrivacyModal from "./PrivacyModal.jsx";

describe("PrivacyModal", () => {
  beforeEach(() => {
    installMockFetch();
  });

  function Opener() {
    const { setShowPrivacyModal } = useUI();
    React.useEffect(() => setShowPrivacyModal(true), [setShowPrivacyModal]);
    return null;
  }

  // The CIOOS privacy guidelines promise a link to the privacy policy of every
  // third party that handles a visitor's personal data.
  it("links the guidelines and each third party's privacy policy", async () => {
    renderWithProviders(
      <>
        <Opener />
        <PrivacyModal />
      </>,
      { providers: "app" },
    );
    const modal = await screen.findByTestId("privacy-modal");
    const hrefs = within(modal)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "https://cioos.ca/privacy-guidelines/",
        "https://policies.google.com/privacy",
        "https://sentry.io/privacy/",
      ]),
    );
  });
});
