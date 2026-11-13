import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createInstance } from "i18next";

import { resources } from "../../../locales/resources.js";
import DatasetCard from "./DatasetCard.jsx";

// DatasetCard takes t/i18n as props, so a stub translator needs no providers.
const t = (key) => key;
const i18n = { language: "en" };

// The real bundles, for the strings whose plurals and units are under test.
function realI18n(lng = "en") {
  const instance = createInstance();
  instance.init({
    lng,
    resources,
    interpolation: { escapeValue: false },
  });
  return { t: instance.t, i18n: instance };
}

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
    expect(screen.getByText("layerTimeseries")).toBeInTheDocument();
  });

  it("names an OBIS occurrence dataset by its Point geometry", () => {
    render(
      <DatasetCard
        row={{ ...ROW, source_type: "obis", cdm_data_type: "Point" }}
        t={t}
        i18n={i18n}
      />,
    );
    expect(screen.getByTitle("datasetsTableHeaderTypeText").textContent).toBe(
      "layerPoint",
    );
  });

  it("opens on a click anywhere, and from the keyboard through its title button", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<DatasetCard row={ROW} t={t} i18n={i18n} onInspect={onInspect} />);
    const card = screen.getByTestId("dataset-card");
    expect(card).not.toHaveAttribute("role");
    await user.click(card);
    expect(onInspect).toHaveBeenCalledWith(ROW);

    onInspect.mockClear();
    screen.getByRole("button", { name: ROW.title }).focus();
    await user.keyboard("{Enter}");
    expect(onInspect).toHaveBeenCalledWith(ROW);
  });

  it("has no title button without onInspect", () => {
    render(<DatasetCard row={ROW} t={t} i18n={i18n} />);
    expect(
      screen.queryByRole("button", { name: ROW.title }),
    ).not.toBeInTheDocument();
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
        name: "datasetsCardSelectForDownloadText: Green Bay LoRaWAN Buoy 4",
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
        name: "datasetsCardSelectForDownloadText: Green Bay LoRaWAN Buoy 4",
      }),
    ).toBeDisabled();
  });

  it("names the grid size as a grid, with no location count, for a Grid dataset", () => {
    const grid = {
      ...ROW,
      cdm_data_type: "Grid",
      grid_dimensions: [
        { name: "longitude", n_values: 184 },
        { name: "latitude", n_values: 80 },
      ],
    };
    const { container } = render(<DatasetCard row={grid} {...realI18n()} />);
    const meta = container.querySelector(".datasetCardMeta");
    expect(meta).toHaveTextContent("184×80 grid");
    expect(meta).not.toHaveTextContent(/location/);
    expect(meta.querySelector(".bi-grid-3x3")).toBeInTheDocument();
    expect(meta.querySelector(".bi-pin-map-fill")).not.toBeInTheDocument();
  });

  it("names each meta figure with its unit, in either language", () => {
    const row = { ...ROW, profiles_count: 1, n_profiles: 1, days: 1234 };
    const { rerender } = render(<DatasetCard row={row} {...realI18n()} />);
    expect(screen.getByTitle("Locations")).toHaveTextContent("1 location");
    expect(screen.getByTitle("Days of data")).toHaveTextContent("1,234 days");

    rerender(<DatasetCard row={row} {...realI18n("fr")} />);
    expect(screen.getByTitle("Emplacements")).toHaveTextContent(
      "1 emplacement",
    );
    expect(screen.getByTitle("Jours de données")).toHaveTextContent(
      /^1\s234 jours$/,
    );
  });

  it("shows how many of the dataset's locations the selection holds when that is fewer", () => {
    const partial = { ...ROW, profiles_count: 3, n_profiles: 10 };
    const { rerender } = render(<DatasetCard row={partial} {...realI18n()} />);
    expect(screen.getByTitle("Locations")).toHaveTextContent(
      "3 of 10 locations",
    );
    rerender(<DatasetCard row={partial} {...realI18n("fr")} />);
    expect(screen.getByTitle("Emplacements")).toHaveTextContent(
      "3 emplacements sur 10",
    );
  });

  it("shows the dataset's days of data when the query carries them", () => {
    const { rerender } = render(
      <DatasetCard row={{ ...ROW, days: 1234 }} t={t} i18n={i18n} />,
    );
    expect(screen.getByTitle("datasetsCardSortDaysText")).toBeInTheDocument();
    rerender(<DatasetCard row={{ ...ROW, days: null }} t={t} i18n={i18n} />);
    expect(
      screen.queryByTitle("datasetsCardSortDaysText"),
    ).not.toBeInTheDocument();
  });

  it("draws trajectories and OBIS as hexagons, like the map's cells", () => {
    const glyph = (row) => {
      const { container, unmount } = render(
        <DatasetCard row={{ ...ROW, ...row }} t={t} i18n={i18n} />,
      );
      const cls = container.querySelector(".datasetCardPlatform svg").classList;
      unmount();
      return cls;
    };
    expect(glyph({ cdm_data_type: "Trajectory" })).toContain("bi-hexagon-fill");
    expect(
      glyph({ cdm_data_type: "Occurrence", source_type: "obis" }),
    ).toContain("bi-hexagon-fill");
    expect(glyph({})).toContain("bi-circle-fill");
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
      expect(link).toHaveAttribute(
        "href",
        "https://seagull-erddap.glos.org/erddap/en/tabledap/obs_270.html",
      );
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
          name: "datasetsCardSelectForDownloadText: Green Bay LoRaWAN Buoy 4",
        }),
      ).toBeDisabled();
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
