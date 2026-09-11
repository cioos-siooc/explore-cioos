import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetInspector from "./DatasetInspector.jsx";

// One record list, whatever the dataset type. A trajectory dataset used to
// carry a second list of the same ids (its "Platforms / Trajectories" table),
// and the two disagreed about what a row was for: one previewed a record, the
// other drew its track. What is asserted here is that consolidation — one list,
// its ids declared as the cf_role they come from, and the track a control on the
// record's own card.

const RECORDS = {
  profiles: [
    {
      profile_id: "mission-a",
      time_min: "2021-01-01T00:00:00Z",
      time_max: "2021-02-01T00:00:00Z",
      depth_min: 0,
      depth_max: 100,
      eovs: null,
    },
    {
      profile_id: "mission-b",
      time_min: "2022-01-01T00:00:00Z",
      time_max: "2022-02-01T00:00:00Z",
      depth_min: 0,
      depth_max: 200,
      eovs: null,
    },
  ],
};

const DATASET = {
  pk: 7,
  title: "Glider missions",
  cdm_data_type: "TrajectoryProfile",
  source_type: "erddap",
  organizations: ["CIOOS"],
  eovs: ["oxygen"],
  platform: "glider",
  profiles_count: 2,
  n_profiles: 2,
  // A TrajectoryProfile declares both roles; the record is the trajectory.
  trajectory_id_variable: "trajectory",
  profile_id_variable: "profile_id",
  erddap_url: "https://erddap.example/tabledap/gliders.html",
};

const emptyFilter = () => ({
  eovFilter: { eovsSelected: [], setEovsSelected: () => {} },
  platformFilter: { platformsSelected: [], setPlatformsSelected: () => {} },
  orgFilter: { orgsSelected: [], setOrgsSelected: () => {} },
  datasetFilter: { datasetsSelected: [], setDatasetsSelected: () => {} },
});

// The record list's payload is the one thing these assertions are about, so it
// is answered here; everything else the app providers ask for still comes from
// the shared fixture set.
function installRecords(records) {
  installMockFetch();
  const fixtureFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/datasetRecordsList")) {
        return new Response(JSON.stringify(records), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return fixtureFetch(input, init);
    }),
  );
}

function open({ dataset = DATASET, records = RECORDS, ...props } = {}) {
  installRecords(records);
  const handlers = {
    setInspectRecordID: vi.fn(),
    setSelectedTrajectory: vi.fn(),
    setHighlightedRecord: vi.fn(),
    ...props,
  };
  const rendered = renderWithProviders(
    <DatasetInspector
      dataset={dataset}
      returnToList={() => {}}
      setHoveredDataset={() => {}}
      filterSet={emptyFilter()}
      query={{}}
      activeWmsOverlay={undefined}
      setActiveWmsOverlay={() => {}}
      {...handlers}
    />,
    { providers: "app" },
  );
  return { ...rendered, ...handlers };
}

const cards = () => document.querySelectorAll(".listCard");
const cardFor = (id) =>
  [...cards()].find((card) => card.querySelector(".listCardId")?.title === id);
const trackButtonIn = (card) => card.querySelector(".listCardTrack");

describe("DatasetInspector record list", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a trajectory dataset's missions once, in a single list", async () => {
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));

    // One list on the page: the platforms table that repeated these same ids,
    // with its own search, sort and pager, is gone.
    expect(document.querySelectorAll(".recordSection")).toHaveLength(1);
    expect(document.querySelectorAll(".cardList")).toHaveLength(1);
    expect(screen.getByText("Record list")).toBeInTheDocument();
    expect(screen.getAllByText("mission-a")).toHaveLength(1);
  });

  it("declares the cf_role a trajectory dataset's ids come from", async () => {
    open();
    await waitFor(() => expect(cards()).toHaveLength(2));

    const caption = document.querySelector(".recordIdCaption");
    expect(caption).toHaveTextContent("Item label: Trajectory ID");
    // The role itself, spelled out — and the variable carrying it, which is not
    // the role's name here.
    expect(caption).toHaveTextContent("cf_role = trajectory_id");
    expect(within(caption).getByText("trajectory")).toBeInTheDocument();
  });

  it("names a profile dataset's ids after its own role instead", async () => {
    open({
      dataset: {
        ...DATASET,
        cdm_data_type: "Profile",
        trajectory_id_variable: "",
      },
    });
    await waitFor(() => expect(cards()).toHaveLength(2));

    const caption = document.querySelector(".recordIdCaption");
    expect(caption).toHaveTextContent("Item label: Profile ID");
    expect(caption).toHaveTextContent("cf_role = profile_id");
    // No track to draw: a profile record sits at a point.
    expect(document.querySelectorAll(".listCardTrack")).toHaveLength(0);
  });

  it("says so when the dataset declares no cf_role at all", async () => {
    open({
      dataset: {
        ...DATASET,
        cdm_data_type: "Other",
        trajectory_id_variable: "",
        profile_id_variable: "",
      },
    });
    await waitFor(() => expect(cards()).toHaveLength(2));

    const caption = document.querySelector(".recordIdCaption");
    expect(caption).toHaveTextContent("Item label: Record ID");
    expect(caption).toHaveTextContent("no cf_role declared");
  });

  it("opens a record's preview when its card is clicked", async () => {
    const { user, setInspectRecordID, setSelectedTrajectory } = open();
    await waitFor(() => expect(cards()).toHaveLength(2));

    await user.click(cardFor("mission-a"));
    expect(setInspectRecordID).toHaveBeenCalledWith("mission-a");
    expect(setSelectedTrajectory).not.toHaveBeenCalled();
  });

  it("draws a record's track from the card's own control, not from opening it", async () => {
    const { user, setInspectRecordID, setSelectedTrajectory } = open();
    await waitFor(() => expect(cards()).toHaveLength(2));

    await user.click(trackButtonIn(cardFor("mission-b")));
    expect(setSelectedTrajectory).toHaveBeenCalledWith({
      datasetPk: 7,
      datasetTitle: "Glider missions",
      trajectoryId: "mission-b",
      // A record in the list gives no clue where its platform sailed.
      frameView: true,
    });
    // The track control is not a way into the preview.
    expect(setInspectRecordID).not.toHaveBeenCalled();
  });

  it("marks the record whose track the map is drawing, and clears it again", async () => {
    const { user, setSelectedTrajectory } = open({
      selectedTrajectory: { datasetPk: 7, trajectoryId: "mission-a" },
    });
    await waitFor(() => expect(cards()).toHaveLength(2));

    const drawn = cardFor("mission-a");
    expect(drawn.className).toContain("selected");
    expect(trackButtonIn(drawn)).toHaveAttribute("aria-pressed", "true");
    expect(trackButtonIn(cardFor("mission-b"))).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(trackButtonIn(drawn));
    expect(setSelectedTrajectory).toHaveBeenCalledWith(undefined);
  });

  it("leaves an unnamed trajectory's card inert but still drawable", async () => {
    // A dataset whose single mission carries no id: '' is what the harvest
    // stores, and ?preview= cannot carry it.
    const { user, setInspectRecordID, setSelectedTrajectory } = open({
      records: {
        profiles: [
          {
            profile_id: "",
            time_min: "2021-01-01T00:00:00Z",
            time_max: "2021-02-01T00:00:00Z",
            depth_min: 0,
            depth_max: 10,
            eovs: null,
          },
        ],
      },
    });
    await waitFor(() => expect(cards()).toHaveLength(1));

    const card = cards()[0];
    expect(card).not.toHaveAttribute("role", "button");
    await user.click(card);
    expect(setInspectRecordID).not.toHaveBeenCalled();

    await user.click(trackButtonIn(card));
    expect(setSelectedTrajectory).toHaveBeenCalledWith(
      expect.objectContaining({ trajectoryId: "" }),
    );
  });
});
