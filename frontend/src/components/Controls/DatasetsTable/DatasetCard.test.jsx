import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DatasetCard from "./DatasetCard.jsx";

// DatasetCard takes t/i18n as plain props rather than calling useTranslation
// itself, so a bare render() with a stub translator is enough — no provider
// wiring needed.
const t = (key) => key;
const i18n = { language: "en" };

const ROW = {
  pk: 1,
  title: "Green Bay LoRaWAN Buoy 4",
  platform: "mooring",
  cdm_data_type: "TimeSeries",
  erddap_url: "https://seagull-erddap.glos.org/erddap/tabledap/obs_270.html",
  profiles_count: 1,
  n_profiles: 1,
};

describe("DatasetCard", () => {
  it("renders the title and type", () => {
    render(<DatasetCard row={ROW} t={t} i18n={i18n} />);
    expect(screen.getByText("Green Bay LoRaWAN Buoy 4")).toBeInTheDocument();
    expect(screen.getByText("Time series")).toBeInTheDocument();
  });

  it("is a clickable, keyboard-operable button when onInspect is given", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<DatasetCard row={ROW} t={t} i18n={i18n} onInspect={onInspect} />);
    const card = screen.getByTestId("dataset-card");
    expect(card).toHaveAttribute("role", "button");
    await user.click(card);
    expect(onInspect).toHaveBeenCalledWith(ROW);

    onInspect.mockClear();
    card.focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenCalledWith(ROW);
  });

  it("is not a button, and has no role, without onInspect", () => {
    render(<DatasetCard row={ROW} t={t} i18n={i18n} />);
    expect(screen.getByTestId("dataset-card")).not.toHaveAttribute("role");
  });

  it("the select checkbox calls onSelect without also triggering onInspect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onInspect = vi.fn();
    render(
      <DatasetCard
        row={ROW}
        t={t}
        i18n={i18n}
        onSelect={onSelect}
        onInspect={onInspect}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "datasetsCardSelectForDownloadText",
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(ROW);
    expect(onInspect).not.toHaveBeenCalled();
  });

  it("disables the select checkbox for a Grid (metadata-only) dataset", () => {
    const grid = { ...ROW, cdm_data_type: "Grid" };
    render(<DatasetCard row={grid} t={t} i18n={i18n} onSelect={() => {}} />);
    expect(
      screen.getByRole("checkbox", {
        name: "datasetsCardSelectForDownloadText",
      }),
    ).toBeDisabled();
  });

  it("shows the griddap type label and grid size instead of profile counts for a Grid dataset", () => {
    const grid = {
      ...ROW,
      cdm_data_type: "Grid",
      grid_dimensions: [
        { name: "longitude", n_values: 184 },
        { name: "latitude", n_values: 80 },
      ],
    };
    render(<DatasetCard row={grid} t={t} i18n={i18n} />);
    // "griddapTypeLabel" appears twice: the platform icon's SVG <title> and
    // the meta row's own text — assert there are two, not one specific node.
    expect(screen.getAllByText("griddapTypeLabel")).toHaveLength(2);
    expect(screen.getByText("184×80")).toBeInTheDocument();
  });

  it("shows profiles_count / n_profiles when they differ", () => {
    const partial = { ...ROW, profiles_count: 3, n_profiles: 10 };
    render(<DatasetCard row={partial} t={t} i18n={i18n} />);
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
  });

  it("shows the dataset's days of data when the query carries them", () => {
    const { rerender } = render(
      <DatasetCard row={{ ...ROW, days: 1234 }} t={t} i18n={i18n} />,
    );
    expect(screen.getByTitle("datasetsCardSortDaysText")).toHaveTextContent(
      "1,234",
    );
    rerender(<DatasetCard row={{ ...ROW, days: null }} t={t} i18n={i18n} />);
    expect(
      screen.queryByTitle("datasetsCardSortDaysText"),
    ).not.toBeInTheDocument();
  });

  it("calls onHover/onHoverEnd on mouse enter/leave", async () => {
    const user = userEvent.setup();
    const onHover = vi.fn();
    const onHoverEnd = vi.fn();
    render(
      <DatasetCard
        row={ROW}
        t={t}
        i18n={i18n}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
      />,
    );
    const card = screen.getByTestId("dataset-card");
    await user.hover(card);
    expect(onHover).toHaveBeenCalledWith(ROW);
    await user.unhover(card);
    expect(onHoverEnd).toHaveBeenCalled();
  });

  describe("download modal variant", () => {
    it("shows a spinner while estimates are loading", () => {
      render(
        <DatasetCard
          row={ROW}
          t={t}
          i18n={i18n}
          isDownloadModal
          estimatesLoading
        />,
      );
      expect(document.querySelector(".datasetsTableSpinner")).toBeTruthy();
    });

    it("shows 'unavailable' once loading finished with no estimate", () => {
      render(
        <DatasetCard
          row={ROW}
          t={t}
          i18n={i18n}
          isDownloadModal
          estimatesLoading={false}
          downloadSizeEstimates={{}}
        />,
      );
      expect(screen.getByText("downloadSizeUnavailable")).toBeInTheDocument();
    });

    it("shows the size and a CDE-downloadable badge once the estimate is ready", () => {
      const withEstimate = {
        ...ROW,
        internalDownload: true,
        sizeEstimate: { filteredSize: 500000, unfilteredSize: 500000 },
      };
      render(
        <DatasetCard
          row={withEstimate}
          t={t}
          i18n={i18n}
          isDownloadModal
          downloadSizeEstimates={{ 1: withEstimate.sizeEstimate }}
        />,
      );
      expect(
        screen.getByTitle("datasetsCardSortDownloadableText"),
      ).toBeInTheDocument();
      expect(screen.getByText("~488.28KB")).toBeInTheDocument();
    });

    it("links out to the source server for every dataset in the modal", () => {
      render(
        <DatasetCard
          row={ROW}
          t={t}
          i18n={i18n}
          isDownloadModal
          downloadSizeEstimates={{ 1: { filteredSize: 500000 } }}
        />,
      );
      const link = screen.getByRole("link", { name: /ERDDAP™/ });
      expect(link).toHaveAttribute("href", ROW.erddap_url);
    });

    it("disables selection when the CDE can't deliver the dataset", () => {
      const external = { ...ROW, internalDownload: false };
      render(
        <DatasetCard
          row={external}
          t={t}
          i18n={i18n}
          isDownloadModal
          onSelect={() => {}}
        />,
      );
      expect(
        screen.getByRole("checkbox", {
          name: "datasetsCardSelectForDownloadText",
        }),
      ).toBeDisabled();
    });

    it("shows the dataset's direct download link and copies its URL", async () => {
      const user = userEvent.setup();
      const downloadLink = {
        url: "https://seagull-erddap.glos.org/erddap/tabledap/obs_270.csv",
        filename: "obs_270.csv",
        format: { label: "CSV" },
      };
      render(
        <DatasetCard
          row={ROW}
          t={t}
          i18n={i18n}
          isDownloadModal
          downloadLink={downloadLink}
          downloadSizeEstimates={{ 1: { filteredSize: 500000 } }}
        />,
      );
      const link = screen.getByRole("link", {
        name: "datasetCardDirectDownloadText",
      });
      expect(link).toHaveAttribute("href", downloadLink.url);

      await user.click(
        screen.getByRole("button", { name: "datasetCardCopyLinkText" }),
      );
      expect(await navigator.clipboard.readText()).toBe(downloadLink.url);
    });

    it("the remove button calls onRemove without also triggering onInspect", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      const onInspect = vi.fn();
      render(
        <DatasetCard
          row={ROW}
          t={t}
          i18n={i18n}
          isDownloadModal
          onRemove={onRemove}
          onInspect={onInspect}
        />,
      );
      await user.click(
        screen.getByRole("button", {
          name: "datasetCardRemoveFromSelectionTitle: Green Bay LoRaWAN Buoy 4",
        }),
      );
      expect(onRemove).toHaveBeenCalledWith(ROW);
      expect(onInspect).not.toHaveBeenCalled();
    });

    it("shows no remove button without an onRemove handler", () => {
      render(<DatasetCard row={ROW} t={t} i18n={i18n} isDownloadModal />);
      expect(
        screen.queryByTitle("datasetCardRemoveFromSelectionTitle"),
      ).not.toBeInTheDocument();
    });
  });
});
