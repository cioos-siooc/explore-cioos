import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetMetadata, {
  DatasetAbstract,
  KeywordsCell,
  LicenseCell,
  MetadataExtentCells,
  Citation,
  NoTranslationNote,
  Organizations,
  localized,
} from "./DatasetMetadata.jsx";
import useDatasetMetadata from "./useDatasetMetadata.js";

const METADATA = {
  abstract: { en: "English abstract", fr: "Résumé français" },
  citation: { en: "Someone (2024). A dataset." },
  doi: "https://doi.org/10.0000/x",
  license: {
    title: "Creative Commons Attribution 4.0 International",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
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

describe("NoTranslationNote", () => {
  it("says when the page's language has no translation", async () => {
    const { i18n } = renderWithProviders(
      <NoTranslationNote values={[{ en: "Title", fr: null }, undefined]} />,
    );
    expect(screen.queryByText(/No English version/)).not.toBeInTheDocument();
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.getByText(/No French translation/)).toBeInTheDocument();
  });

  it("stays quiet when every value is translated", async () => {
    const { i18n } = renderWithProviders(
      <NoTranslationNote
        values={[
          { en: "T", fr: "T" },
          { en: "A", fr: "A" },
        ]}
      />,
    );
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.queryByText(/No French translation/)).not.toBeInTheDocument();
  });

  it("flags an abstract that lacks the language even when the title has it", async () => {
    const { i18n } = renderWithProviders(
      <NoTranslationNote values={[{ en: "T", fr: "T" }, { en: "A" }]} />,
    );
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.getByText(/No French translation/)).toBeInTheDocument();
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
      <DatasetAbstract metadata={{ abstract: { en: "word ".repeat(200) } }} />,
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

const DATASET = {
  dataset_id: "example_ctd",
  organizations: ["An institute"],
  erddap_url: "https://erddap.example.org/erddap/tabledap/example_ctd.html",
  erddap_server_url: "https://erddap.example.org/erddap",
  ckan_url: "https://catalogue.cioos.ca/dataset/abc",
};

const renderCards = (props) =>
  renderWithProviders(
    <DatasetMetadata dataset={DATASET} metadata={METADATA} {...props} />,
  );

describe("DatasetMetadata", () => {
  it("shows every card with something in it, and no others", () => {
    renderCards();
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Resources"]);
    expect(
      screen
        .getByText("Dates, contacts, projects and history")
        .closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("leaves the fine print out when the record has none", () => {
    renderCards({
      metadata: { ...METADATA, progress: undefined, contacts: [] },
    });
    expect(
      screen.queryByText("Dates, contacts, projects and history"),
    ).toBeNull();
  });

  it("lists the dataset's own access links before its catalogue's, each once", () => {
    renderCards();
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.classList.contains("metadataResource"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://erddap.example.org/erddap/en/tabledap/example_ctd.html",
      "https://erddap.example.org/erddap/en/info/example_ctd/index.html",
      "https://erddap.example.org/erddap/metadata/iso19115/xml/example_ctd_iso19115.xml",
      "https://catalogue.cioos.ca/en/dataset/abc",
      "https://example.org",
    ]);
    expect(links[0]).toHaveTextContent("Data access form");
    expect(links[0]).toHaveTextContent("erddap.example.org");
    expect(links[4]).toHaveTextContent("More information");
  });

  it("shows a catalogue resource in the page's language, or in none", async () => {
    const { i18n } = renderCards({
      metadata: {
        resources: [
          { name: { en: "English", fr: "Français" }, url: "https://a.org" },
          { name: "Only French", url: "https://b.org", language: "fr" },
        ],
      },
    });
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.queryByText("Only French")).not.toBeInTheDocument();
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.getByText("Français")).toBeInTheDocument();
    expect(screen.getByText("Only French")).toBeInTheDocument();
  });

  it("lists contacts by name and role, those the citation names first", () => {
    renderCards({
      metadata: {
        contacts: [
          { name: "Data Office", roles: ["distributor"], cited: false },
          { name: "Doe, Jane", roles: ["author"], cited: true },
        ],
      },
    });
    const items = screen
      .getByRole("heading", { level: 4, name: "Contacts" })
      .parentElement.querySelectorAll("li");
    expect(items[0]).toHaveTextContent("Doe, Jane");
    expect(items[0]).toHaveTextContent("Author");
    expect(items[1]).toHaveTextContent("Data Office");
  });

  it("puts the record's dates and status in the fine print", () => {
    renderCards({
      metadata: { ...METADATA, dates: { created: "2019-04-01T00:00:00Z" } },
    });
    expect(screen.getByText("Created").parentElement).toHaveTextContent(
      "Created2019-04-01",
    );
    expect(screen.getByText("Status").parentElement).toHaveTextContent(
      "Ongoing",
    );
  });

  it("copies the citation from an icon button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Citation metadata={METADATA} />);
    await user.click(screen.getByRole("button", { name: "Citation" }));
    await user.click(screen.getByRole("button", { name: "Copy citation" }));
    // user-event stands in its own clipboard for the browser's.
    expect(await navigator.clipboard.readText()).toBe(
      "Someone (2024). A dataset.",
    );
    expect(
      await screen.findByRole("button", { name: "Citation copied" }),
    ).toBeInTheDocument();
  });

  it("never shows a contact's email", () => {
    renderCards();
    expect(screen.getByText("Doe, Jane")).toBeInTheDocument();
    expect(screen.queryByText("jane@example.org")).not.toBeInTheDocument();
  });

  it("translates known role codes and spells out unknown ones", () => {
    renderCards();
    expect(
      screen.getByText("Principal investigator, Some New Role"),
    ).toBeInTheDocument();
  });

  it("still lists the access links before a re-harvest", () => {
    renderCards({ metadata: {} });
    expect(
      screen.getByRole("link", { name: /Data access form/ }),
    ).toBeInTheDocument();
  });

  it("says a failed load failed, with a retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    renderCards({ metadata: undefined, error: true, retry });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The dataset's metadata could not be loaded.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("Organizations", () => {
  it("lists each organization once", () => {
    const { container } = renderWithProviders(
      <Organizations
        metadata={{
          ...METADATA,
          contacts: [
            { name: "Doe, Jane", organization: "An institute" },
            { name: "Roe, Rick", organization: "An Institute" },
            { organization: "Data Office" },
            { name: "No Org" },
          ],
        }}
      />,
    );
    expect(
      [...container.querySelectorAll(".metadataChip")].map(
        (c) => c.textContent,
      ),
    ).toEqual(["An institute", "Data Office"]);
  });

  it("folds organizations past the third behind a count, and unfolds them", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <Organizations
        metadata={{
          contacts: ["A", "B", "C", "D", "E"].map((organization) => ({
            organization,
          })),
        }}
      />,
    );
    const chips = () =>
      [...container.querySelectorAll(".metadataChip")].map(
        (c) => c.textContent,
      );
    expect(chips()).toEqual(["A", "B", "C", "+2"]);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(chips()).toEqual(["A", "B", "C", "D", "E", "Show less"]);
  });

  it("carries the full name of an organization as its title", () => {
    const name = "A very long institute name that the chip crops";
    renderWithProviders(
      <Organizations metadata={{ contacts: [{ organization: name }] }} />,
    );
    expect(screen.getByText(name)).toHaveAttribute("title", name);
  });

  it("renders nothing without organizations", () => {
    const { container } = renderWithProviders(<Organizations metadata={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Citation", () => {
  it("shows the citation in a popup on click, adding a DOI it lacks", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Citation metadata={METADATA} />);
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Citation" }));
    expect(screen.getByText(/A dataset\./)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://doi.org/10.0000/x" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
  });

  it("shows the citation on hover", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Citation metadata={METADATA} />);
    await user.hover(screen.getByRole("button", { name: "Citation" }));
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
    expect(await screen.findByText(/A dataset\./)).toBeInTheDocument();
    await user.unhover(screen.getByRole("button", { name: "Citation" }));
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
  });

  it("does not open when the pointer only passes over", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Citation metadata={METADATA} />);
    const button = screen.getByRole("button", { name: "Citation" });
    await user.hover(button);
    await user.unhover(button);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
  });

  it("says the source gave no citation or DOI", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Citation metadata={{}} />);
    await user.click(screen.getByRole("button", { name: "Citation" }));
    expect(
      screen.getByText(/has not supplied a citation or DOI/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy citation" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing while the metadata loads", () => {
    const { container } = renderWithProviders(
      <Citation metadata={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LicenseCell", () => {
  it("names the license briefly, its full wording on hover", () => {
    renderWithProviders(
      <dl>
        <LicenseCell metadata={METADATA} />
      </dl>,
    );
    const pill = screen.getByRole("link", { name: "CC BY 4.0" });
    expect(pill).toHaveAttribute(
      "title",
      "Creative Commons Attribution 4.0 International",
    );
  });
});

describe("facts sheet cells", () => {
  it("shows the declared period and depth, and only those it has", () => {
    renderWithProviders(
      <dl>
        <MetadataExtentCells
          metadata={{
            temporal_extent: { begin: "2019-04-01", end: "2023-10-30" },
          }}
        />
      </dl>,
    );
    expect(screen.getByText("Time period").parentElement).toHaveTextContent(
      "2019-04-01 – 2023-10-30",
    );
    expect(screen.queryByText("Depth")).toBeNull();
  });

  it("lists keywords as chips", () => {
    renderWithProviders(
      <dl>
        <KeywordsCell metadata={METADATA} />
      </dl>,
    );
    expect(screen.getByText("temperature")).toHaveClass("metadataChip");
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
