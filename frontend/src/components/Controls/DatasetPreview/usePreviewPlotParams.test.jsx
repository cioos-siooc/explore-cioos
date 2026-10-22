import * as React from "react";
import { describe, it, expect } from "vitest";
import { act } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import usePreviewPlotParams, {
  MAX_COLOR_PANELS,
} from "./usePreviewPlotParams.js";

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

// The colour plot is offered only for a record holding many profiles.
const STATION_DATASET = { ...DATASET, cdm_data_type: "TimeSeriesProfile" };
function openStation(search = "") {
  return renderWithProviders(<Probe dataset={STATION_DATASET} />, {
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
      expect(api.plotType).toBe("markers+lines");
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

      await run(() => api.setPlotType("markers+lines"));
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

  describe("inverting a Y axis", () => {
    it("draws depth downwards without adding to the link", () => {
      open();
      expect(api.yAxisColumns).toEqual(["depth"]);
      expect(api.reversedYAxes.has("depth")).toBe(true);
      expect(param("pyflip")).toBeNull();
    });

    it("writes the flip and deletes it on the way back", async () => {
      open();
      await run(() => api.setYAxisReversed("depth", false));
      expect(param("pyflip")).toBe("depth");
      expect(api.reversedYAxes.has("depth")).toBe(false);

      await run(() => api.setYAxisReversed("depth", true));
      expect(param("pyflip")).toBeNull();
    });

    it("does not reverse a non-vertical Y unless asked", async () => {
      openStation("playout=color&pcy=salinity");
      expect(api.yAxisColumns).toEqual(["salinity"]);
      expect(api.reversedYAxes.has("salinity")).toBe(false);

      await run(() => api.setYAxisReversed("salinity", true));
      expect(param("pyflip")).toBe("salinity");
      expect(api.reversedYAxes.has("salinity")).toBe(true);
    });

    it("gives every panel of a stack its own Y axis to flip", async () => {
      renderWithProviders(
        <Probe dataset={{ ...DATASET, cdm_data_type: "TimeSeries" }} />,
        { url: "/?pvars=temperature,salinity" },
      );
      expect(api.yAxisColumns).toEqual(["temperature", "salinity"]);

      await run(() => api.setYAxisReversed("salinity", true));
      expect(api.reversedYAxes.has("salinity")).toBe(true);
      expect(api.reversedYAxes.has("temperature")).toBe(false);
    });

    it("draws the dataset's altitude proxy downwards, and flips it back", async () => {
      const table = {
        columnNames: ["PRES", "temperature", "time"],
        columnTypes: ["float", "float", "String"],
        columnUnits: ["dbar", "degree_C", "UTC"],
        altitudeProxyColumn: "PRES",
      };
      const data = [
        { PRES: 1, temperature: 10, time: "2024-01-01T00:00:00Z" },
        { PRES: 2, temperature: 9, time: "2024-01-01T00:05:00Z" },
      ];
      renderWithProviders(
        <Probe
          dataset={{ ...DATASET, cdm_data_type: "TimeSeries" }}
          table={table}
          data={data}
        />,
        { url: "/?pvars=PRES,temperature" },
      );
      expect(api.yAxisColumns).toEqual(["PRES", "temperature"]);
      expect(api.reversedYAxes.has("PRES")).toBe(true);
      expect(api.reversedYAxes.has("temperature")).toBe(false);
      expect(param("pyflip")).toBeNull();

      await run(() => api.setYAxisReversed("PRES", false));
      expect(param("pyflip")).toBe("PRES");
      expect(api.reversedYAxes.has("PRES")).toBe(false);
    });

    it("keeps a variable's flip while it leaves Y and comes back", async () => {
      openStation("playout=color&pcy=salinity&pyflip=salinity");
      await run(() => api.setColorY("depth"));
      expect(api.reversedYAxes.has("depth")).toBe(true);

      await run(() => api.setColorY("salinity"));
      expect(api.reversedYAxes.has("salinity")).toBe(true);
    });

    it("changes uirevision, so a kept zoom cannot hold the old direction", async () => {
      open();
      const before = api.uirevision;
      await run(() => api.setYAxisReversed("depth", false));
      expect(api.uirevision).not.toBe(before);
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
      expect(api.plotType).toBe("markers+lines");
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

  describe("a track's distance axes", () => {
    const TRACK_TABLE = {
      columnNames: ["time", "latitude", "longitude", "temperature"],
      columnTypes: ["String", "float", "float", "float"],
      columnUnits: ["UTC", "degrees_north", "degrees_east", "degree_C"],
    };
    const TRACK_DATA = [
      {
        time: "2024-01-01T01:00:00Z",
        latitude: 1,
        longitude: 0,
        temperature: 9,
      },
      {
        time: "2024-01-01T00:00:00Z",
        latitude: 0,
        longitude: 0,
        temperature: 10,
      },
    ];
    const openTrack = (cdmDataType) =>
      renderWithProviders(
        <Probe
          dataset={{ cdm_data_type: cdmDataType }}
          table={TRACK_TABLE}
          data={TRACK_DATA}
        />,
        { url: "/" },
      );

    it("lists the index and both distances first for a trajectory, carried on the drawn rows", () => {
      openTrack("Trajectory");
      expect(api.plan.sharedCandidates.slice(0, 3)).toEqual([
        "position_index",
        "total_distance_traveled",
        "euclidean_distance",
      ]);
      expect(api.sharedAxis).toBe("position_index");
      expect(api.plotData.map((row) => row.total_distance_traveled)).toEqual([
        0,
        expect.closeTo(111.195, 3),
      ]);
    });

    it("offers them on a trajectory profile too, but not on a profile", () => {
      openTrack("TrajectoryProfile");
      expect(api.variablesByName.has("total_distance_traveled")).toBe(true);
      openTrack("Profile");
      expect(api.variablesByName.has("total_distance_traveled")).toBe(false);
    });
  });

  describe("the colour plot", () => {
    it("opens on panels, adding nothing to the link", () => {
      openStation();
      expect(api.plotLayout).toBe("panels");
      ["playout", "pcx", "pcy", "pzscales"].forEach((name) =>
        expect(param(name)).toBeNull(),
      );
    });

    it("is not offered for a record of one profile, whatever the link says", () => {
      open("playout=color");
      expect(api.colorPlotAvailable).toBe(false);
      expect(api.plotLayout).toBe("panels");
    });

    it("runs time across depth, keeping the variables already picked", async () => {
      openStation("pvars=temperature,salinity");
      await run(() => api.setPlotLayout("color"));
      expect(param("playout")).toBe("color");
      expect(api.colorX).toBe("time");
      expect(api.colorY).toBe("depth");
      expect(api.panels).toEqual(["temperature", "salinity"]);

      await run(() => api.setPlotLayout("panels"));
      expect(param("playout")).toBeNull();
    });

    it("never shades a panel by its own X or Y", () => {
      openStation("playout=color&pvars=temperature,depth,time,salinity");
      expect(api.panels).toEqual(["temperature", "salinity"]);
    });

    it("keeps the first five colour variables of a link, and only there", () => {
      const measurements = ["m1", "m2", "m3", "m4", "m5", "m6"];
      const wideTable = {
        columnNames: ["depth", "time", ...measurements],
        columnTypes: ["float", "String", ...measurements.map(() => "float")],
        columnUnits: ["m", "UTC", ...measurements.map(() => null)],
      };
      const pvars = `pvars=${measurements.join(",")}`;
      const openWide = (search) =>
        renderWithProviders(
          <Probe dataset={STATION_DATASET} table={wideTable} data={[]} />,
          {
            url: `/?${search}`,
          },
        );

      openWide(`playout=color&${pvars}`);
      expect(api.panels).toEqual(measurements.slice(0, MAX_COLOR_PANELS));

      openWide(pvars);
      expect(api.panels).toEqual(measurements); // the panels layout is not capped
    });

    it("drops a colour variable moved onto an axis in the same write", async () => {
      openStation("playout=color&pvars=temperature,salinity");
      await run(() => api.setColorX("salinity"));
      expect(param("pcx")).toBe("salinity");
      expect(param("pvars")).toBeNull(); // back to the default [temperature]
      expect(api.panels).toEqual(["temperature"]);

      await run(() => api.setColorX("time"));
      expect(param("pcx")).toBeNull();
    });

    it("falls back to the default axes for columns this dataset lacks", () => {
      openStation("playout=color&pcx=nope&pcy=gone");
      expect(api.colorX).toBe("time");
      expect(api.colorY).toBe("depth");
    });

    it("stores a per-variable scale and deletes it on the way back", async () => {
      openStation("playout=color");
      await run(() => api.setVariableScale("temperature", "Cividis"));
      expect(param("pzscales")).toBe("temperature~Cividis");
      expect(api.variableScales).toEqual({ temperature: "Cividis" });

      await run(() => api.setVariableScale("temperature", null));
      expect(param("pzscales")).toBeNull();
    });

    it("changes uirevision when the colour plot's axes change", async () => {
      openStation("playout=color");
      const before = api.uirevision;
      await run(() => api.setColorY("salinity"));
      expect(api.uirevision).not.toBe(before);
    });
  });
});
