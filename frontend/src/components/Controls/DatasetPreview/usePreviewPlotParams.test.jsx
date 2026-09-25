import * as React from "react";
import { describe, it, expect } from "vitest";
import { act } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import usePreviewPlotParams from "./usePreviewPlotParams.js";

// The hook is the sole owner of URL <-> plot state, and two of its rules are
// invisible from the outside: a param is written ONLY when it differs from the
// type's default, and two settings that must not disagree are written in ONE
// call (react-router hands a functional updater the params from the last
// render, so a second call in the same handler would read a stale snapshot).
// Both are asserted here against window.location, which is what a share link
// actually carries.

const TABLE = {
  columnNames: ["depth", "temperature", "salinity", "time"],
  columnTypes: ["float", "float", "float", "String"],
  columnUnits: ["m", "degree_C", "PSU", "UTC"],
};

const DATASET = { cdm_data_type: "Profile", first_eov_column: "temperature" };

const DATA = [
  { depth: 0, temperature: 10, salinity: 30, time: "2024-01-01T00:00:00Z" },
  { depth: 5, temperature: 9, salinity: 31, time: "2024-01-01T00:05:00Z" },
];

let api;

function Probe({ dataset = DATASET, table = TABLE, data = DATA }) {
  api = usePreviewPlotParams(dataset, table, data);
  return null;
}

function open(search = "") {
  return renderWithProviders(<Probe />, {
    url: search ? `/?${search}` : "/",
  });
}

const params = () => new URLSearchParams(window.location.search);
const param = (name) => params().get(name);

// Every setter writes through react-router, so the navigation has to flush
// before the address can be read back.
const run = async (change) => {
  await act(async () => {
    change();
  });
};

describe("usePreviewPlotParams", () => {
  describe("what a dataset type opens on", () => {
    it("shares the vertical coordinate and opens the first EOV column", () => {
      open();
      expect(api.sharedAxis).toBe("depth");
      expect(api.panels).toEqual(["temperature"]);
      expect(api.plotType).toBe("markers");
      expect(api.selectedVis).toBe("plot");
    });

    it("adds nothing to the link while nothing has been overridden", () => {
      open();
      ["vis", "paxis", "pvars", "pmode", "pcolors", "pz", "pzscale"].forEach(
        (name) => expect(param(name)).toBeNull(),
      );
    });

    it("opens on the table for a type with no layout", () => {
      renderWithProviders(<Probe dataset={{ cdm_data_type: "Grid" }} />, {
        url: "/",
      });
      expect(api.selectedVis).toBe("table");
      expect(api.plan).toBeNull();
    });
  });

  describe("only the deviation is stored", () => {
    it("writes a non-default mode and deletes it on the way back", async () => {
      open();
      await run(() => api.setPlotType("lines"));
      expect(param("pmode")).toBe("lines");

      await run(() => api.setPlotType("markers"));
      expect(param("pmode")).toBeNull();
    });

    it("writes a non-default panel set and deletes it on the way back", async () => {
      open();
      await run(() => api.setPanels(["temperature", "salinity"]));
      expect(param("pvars")).toBe("temperature,salinity");

      await run(() => api.setPanels(["temperature"]));
      expect(param("pvars")).toBeNull();
    });

    it("keeps an emptied panel set as a sentinel, not as the defaults", async () => {
      open();
      await run(() => api.setPanels([]));
      expect(param("pvars")).toBe("-");
      expect(api.panels).toEqual([]);
    });
  });

  describe("settings that must not disagree are written together", () => {
    it("drops a column from the panels when it becomes the shared axis", async () => {
      open("pvars=temperature,salinity");
      expect(api.panels).toEqual(["temperature", "salinity"]);

      await run(() => api.setSharedAxis("temperature"));

      expect(param("paxis")).toBe("temperature");
      expect(param("pvars")).toBe("salinity");
      expect(api.panels).toEqual(["salinity"]);
    });

    it("clears the colour scale when the colour column changes", async () => {
      open();
      await run(() => api.setColorAxis("salinity"));
      await run(() => api.setColorScale("Cividis"));
      expect(param("pz")).toBe("salinity");
      expect(param("pzscale")).toBe("Cividis");

      await run(() => api.setColorAxis("temperature"));

      expect(param("pz")).toBe("temperature");
      expect(param("pzscale")).toBeNull();
    });
  });

  describe("a link naming something this dataset does not have", () => {
    it("falls back to the plan's own axis", () => {
      open("paxis=not_a_column");
      expect(api.sharedAxis).toBe("depth");
    });

    it("drops an unknown panel rather than drawing it empty", () => {
      open("pvars=temperature,not_a_column");
      expect(api.panels).toEqual(["temperature"]);
    });

    it("turns colour off rather than substituting another column", () => {
      open("pz=not_a_column");
      expect(api.colorAxis).toBeNull();
    });

    it("ignores a banned scale from a hand-edited link", () => {
      open("pz=salinity&pzscale=Jet");
      expect(api.colorAxis).toBe("salinity");
      expect(api.colorScale).toBeNull();
    });

    it("ignores an unknown plot mode", () => {
      open("pmode=sausage");
      expect(api.plotType).toBe("markers");
    });
  });

  describe("panels", () => {
    it("toggles a variable on and back off", async () => {
      open();
      await run(() => api.togglePanel("salinity"));
      expect(api.panels).toEqual(["temperature", "salinity"]);

      await run(() => api.togglePanel("salinity"));
      expect(api.panels).toEqual(["temperature"]);
    });

    it("never lets the shared axis be a panel", async () => {
      open();
      await run(() => api.setPanels(["depth", "temperature"]));
      expect(api.panels).toEqual(["temperature"]);
    });
  });

  it("changes uirevision when the axis set changes, so no zoom is restored onto a dead axis", async () => {
    open();
    const before = api.uirevision;
    await run(() => api.togglePanel("salinity"));
    expect(api.uirevision).not.toBe(before);
  });

  it("offers every numeric or time column as a colour candidate", () => {
    open();
    expect(api.colorCandidates.map((v) => v.columnName)).toEqual([
      "depth",
      "time",
      "temperature",
      "salinity",
    ]);
  });
});
