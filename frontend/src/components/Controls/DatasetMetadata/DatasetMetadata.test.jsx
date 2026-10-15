import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetMetadata, {
  DatasetAbstract,
  localized,
} from "./DatasetMetadata.jsx";
import useDatasetMetadata from "./useDatasetMetadata.js";

const METADATA = {
  abstract: { en: "English abstract", fr: "Résumé français" },
  citation: { en: "Someone (2024). A dataset." },
  doi: "https://doi.org/10.0000/x",
  contacts: [
    {
      name: "Doe, Jane",
      organization: "An institute",
      email: "jane@example.org",
      roles: ["principalInvestigator", "someNewRole"],
    },
  ],
  keywords: { en: ["temperature", "salinity"] },
  progress: "onGoing",
  resources: [{ name: "infoUrl", url: "https://example.org" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("localized", () => {
  it("falls back to the other language when the page's is missing", () => {
    expect(localized({ en: "en", fr: "fr" }, "fr-CA")).toBe("fr");
    expect(localized({ en: "en" }, "fr")).toBe("en");
    expect(localized({ fr: "fr" }, "en")).toBe("fr");
    expect(localized(undefined, "en")).toBeUndefined();
  });
});

describe("DatasetAbstract", () => {
  it("renders the abstract in the page's language", async () => {
    const { i18n } = renderWithProviders(
      <DatasetAbstract metadata={METADATA} />,
    );
    expect(screen.getByText("English abstract")).toBeInTheDocument();
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.getByText("Résumé français")).toBeInTheDocument();
  });

  it("clamps a long abstract behind Show more", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DatasetAbstract metadata={{ abstract: { en: "word ".repeat(100) } }} />,
    );
    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(document.querySelector(".datasetAbstractText")).toHaveClass(
      "clamped",
    );
    await user.click(toggle);
    expect(document.querySelector(".datasetAbstractText")).not.toHaveClass(
      "clamped",
    );
    expect(toggle).toHaveTextContent("Show less");
  });

  it("renders the abstract as markdown", () => {
    renderWithProviders(
      <DatasetAbstract
        metadata={{
          abstract: { en: "**Bold** text\n\n- one\n- [link](https://x.org)" },
        }}
      />,
    );
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://x.org",
    );
  });

  it("shows publisher HTML and unsafe links as text, never as markup", () => {
    const { container } = renderWithProviders(
      <DatasetAbstract
        metadata={{
          abstract: {
            en: '<img src=x onerror="alert(1)"> [click](javascript:alert(1))',
          },
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)"> click');
  });

  it("renders nothing without an abstract", () => {
    const { container } = renderWithProviders(
      <DatasetAbstract metadata={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DatasetMetadata", () => {
  it("shows every card with something in it, open, and no others", () => {
    renderWithProviders(<DatasetMetadata metadata={METADATA} />);
    const sections = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(sections).toEqual([
      "How to cite",
      "Contacts",
      "Keywords",
      "Dates and extent",
      "Resources",
    ]);
  });

  it("translates known codes and spells out unknown ones", () => {
    renderWithProviders(<DatasetMetadata metadata={METADATA} />);
    expect(
      screen.getByText("Principal investigator, Some New Role"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "More information" }),
    ).toHaveAttribute("href", "https://example.org");
  });

  it("renders nothing for a dataset not yet re-harvested", () => {
    const { container } = renderWithProviders(
      <DatasetMetadata metadata={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says a failed load failed, with a retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    renderWithProviders(<DatasetMetadata error retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The dataset's metadata could not be loaded.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

function HookProbe({ pk }) {
  const { metadata, loading, error, retry } = useDatasetMetadata(pk);
  if (loading) return <span>loading</span>;
  if (error) {
    return (
      <button type="button" onClick={retry}>
        failed
      </button>
    );
  }
  return <span>{metadata.abstract.en.slice(0, 12)}</span>;
}

describe("useDatasetMetadata", () => {
  it("loads the dataset's metadata by pk", async () => {
    const missing = installMockFetch();
    renderWithProviders(<HookProbe pk={2337} />);
    expect(await screen.findByText("Conductivity")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/datasets/metadata?datasetPKs=2337"),
      expect.anything(),
    );
    expect(missing).toEqual([]);
  });

  it("retries after a failure", async () => {
    const user = userEvent.setup();
    installMockFetch();
    const fixtureFetch = globalThis.fetch;
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) =>
        failing
          ? new Response("<html>504</html>", { status: 504 })
          : fixtureFetch(input, init),
      ),
    );
    renderWithProviders(<HookProbe pk={2337} />);
    const button = await screen.findByRole("button", { name: "failed" });
    failing = false;
    await user.click(button);
    await waitFor(() =>
      expect(screen.getByText("Conductivity")).toBeInTheDocument(),
    );
  });
});
