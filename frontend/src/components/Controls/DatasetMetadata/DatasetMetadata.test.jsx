import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetMetadata, {
  DatasetAbstract,
  LicensePill,
  MetadataSheetRows,
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
    ).toEqual(["How to cite", "Organizations and contacts", "Resources"]);
  });

  it("lists the dataset's own access links before its catalogue's, each once", () => {
    renderCards();
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.classList.contains("metadataResource"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      DATASET.erddap_url,
      "https://erddap.example.org/erddap/info/example_ctd/index.html",
      "https://erddap.example.org/erddap/metadata/iso19115/xml/example_ctd_iso19115.xml",
      DATASET.ckan_url,
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

  it("groups contacts by whether the citation names them", () => {
    renderCards({
      metadata: {
        contacts: [
          { name: "Doe, Jane", roles: ["author"], cited: true },
          { name: "Data Office", roles: ["distributor"], cited: false },
        ],
      },
    });
    const cited = screen.getByRole("heading", { level: 4, name: "Cited" });
    expect(cited.parentElement).toHaveTextContent("Doe, Jane");
    const other = screen.getByRole("heading", {
      level: 4,
      name: "Other contacts",
    });
    expect(other.parentElement).toHaveTextContent("Data Office");
  });

  it("hides the citation until asked, and adds a DOI it lacks", async () => {
    const user = userEvent.setup();
    renderCards();
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText(/A dataset\./)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://doi.org/10.0000/x" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(/A dataset\./)).not.toBeInTheDocument();
  });

  it("copies the citation from an icon button while it is hidden", async () => {
    const user = userEvent.setup();
    renderCards();
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

  it("names a contact's organization first, once when it is the only name", () => {
    renderCards({
      metadata: {
        contacts: [
          { name: "Doe, Jane", organization: "An institute" },
          { organization: "Data Office" },
        ],
      },
    });
    const org = screen.getByText("An institute");
    expect(org).toHaveClass("metadataContactOrg");
    expect(org.nextElementSibling).toHaveTextContent("Doe, Jane");
    expect(screen.getAllByText("Data Office")).toHaveLength(1);
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

describe("LicensePill", () => {
  it("names the license briefly, its full wording on hover", () => {
    renderWithProviders(<LicensePill metadata={METADATA} />);
    const pill = screen.getByRole("link", { name: "License CC BY 4.0" });
    expect(pill).toHaveAttribute(
      "title",
      "Creative Commons Attribution 4.0 International",
    );
  });
});

describe("MetadataSheetRows", () => {
  it("adds keywords and single-line date pills to the metadata sheet", () => {
    renderWithProviders(
      <dl>
        <MetadataSheetRows
          metadata={{
            ...METADATA,
            dates: { created: "2019-04-01T00:00:00Z" },
            temporal_extent: { begin: "2019-04-01", end: "2023-10-30" },
          }}
        />
      </dl>,
    );
    expect(screen.getByText("temperature")).toHaveClass("metadataChip");
    expect(screen.getByText("Created").parentElement).toHaveTextContent(
      "Created2019-04-01",
    );
    expect(screen.getByText("Time period").parentElement).toHaveTextContent(
      "2019-04-01 – 2023-10-30",
    );
    expect(screen.getByText("Status").parentElement).toHaveTextContent(
      "Ongoing",
    );
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
