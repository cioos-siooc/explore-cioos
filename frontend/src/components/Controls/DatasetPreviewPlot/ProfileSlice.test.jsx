import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import ProfileSlice from "./ProfileSlice.jsx";

const stepsOf = (count) =>
  Array.from({ length: count }, (_, index) => ({
    value: `AZMP-ESG-cast-${index}`,
    time: `2021-05-${String(20 + index).padStart(2, "0")}T23:01:41Z`,
  }));

const profilesOf = (count, extra = {}) => ({
  column: "profile",
  steps: stepsOf(count),
  count,
  truncated: false,
  ...extra,
});

// Cleans up first, so a test may show the control at more than one selection
// without two sliders answering getByRole.
const show = (profiles, step = null) => {
  cleanup();
  const setStep = vi.fn();
  renderWithProviders(
    <ProfileSlice profiles={profiles} step={step} setStep={setStep} />,
    { providers: "none" },
  );
  return setStep;
};

describe("ProfileSlice", () => {
  it("draws nothing for a record whose profiles it could not step through", () => {
    // A Profile, a TimeSeries or a trajectory: one profile and the All stop
    // draw the same rows, so there is nothing to pick between.
    show({ column: null, steps: [], count: 0, truncated: false });
    expect(screen.queryByRole("slider")).toBeNull();

    show(profilesOf(1));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("opens on every profile at once, which is what the plot drew before", () => {
    show(profilesOf(335));
    expect(screen.getByText("All in this window")).toBeInTheDocument();
    expect(screen.getByText("0 / 335")).toBeInTheDocument();
    // There is nothing before the window, and there is a profile after it.
    expect(screen.getByTitle("Previous profile")).toBeDisabled();
    expect(screen.getByTitle("Next profile")).not.toBeDisabled();
  });

  it("names the selected cast by when it was taken, in full and in UTC", () => {
    // The whole day and minute, spelled the way the record card this preview
    // was opened from spells it (formatInstant). It used to be cut short by the
    // parameters pane it lived in, which is why the control moved above the
    // plot.
    show(profilesOf(335), "AZMP-ESG-cast-2");
    expect(screen.getByText("2021-05-22 23:01Z")).toBeInTheDocument();
    expect(screen.getByText("3 / 335")).toBeInTheDocument();
  });

  it("falls back to the profile's own id when it carries no time", () => {
    show(
      {
        column: "profile",
        count: 2,
        truncated: false,
        steps: [
          { value: "cast-a", time: null },
          { value: "cast-b", time: null },
        ],
      },
      "cast-b",
    );
    expect(screen.getByText("cast-b")).toBeInTheDocument();
  });

  it("steps to the next and previous profile by value, not by index", () => {
    const setStep = show(profilesOf(335), "AZMP-ESG-cast-2");
    fireEvent.click(screen.getByTitle("Next profile"));
    expect(setStep).toHaveBeenCalledWith("AZMP-ESG-cast-3");

    const back = show(profilesOf(335), "AZMP-ESG-cast-2");
    fireEvent.click(screen.getByTitle("Previous profile"));
    expect(back).toHaveBeenCalledWith("AZMP-ESG-cast-1");
  });

  it("steps back off the first profile onto the window, not past it", () => {
    const setStep = show(profilesOf(335), "AZMP-ESG-cast-0");
    fireEvent.click(screen.getByTitle("Previous profile"));
    expect(setStep).toHaveBeenCalledWith(null);
  });

  it("stops at the last profile", () => {
    show(profilesOf(3), "AZMP-ESG-cast-2");
    expect(screen.getByTitle("Next profile")).toBeDisabled();
  });

  it("walks with the keyboard, a page at a time with Shift", () => {
    const setStep = show(profilesOf(335), "AZMP-ESG-cast-4");
    const handle = screen.getByRole("slider");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(setStep).toHaveBeenCalledWith("AZMP-ESG-cast-5");

    const far = show(profilesOf(335), "AZMP-ESG-cast-4");
    fireEvent.keyDown(screen.getByRole("slider"), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(far).toHaveBeenCalledWith("AZMP-ESG-cast-14");

    const end = show(profilesOf(335), "AZMP-ESG-cast-4");
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(end).toHaveBeenCalledWith("AZMP-ESG-cast-334");
  });

  it("falls back to the window when a link names a profile this record lacks", () => {
    show(profilesOf(335), "a-cast-from-another-station");
    expect(screen.getByText("All in this window")).toBeInTheDocument();
    expect(screen.getByText("0 / 335")).toBeInTheDocument();
  });

  it("says the stops are a sample when the record holds more than it sent", () => {
    // mpoSgdoADCP's longest record: 48166 casts, 4818 of them reachable. A
    // readout of "4818" with no qualifier would claim the rest do not exist.
    show(
      profilesOf(4818, { count: 48166, truncated: true }),
      "AZMP-ESG-cast-2",
    );
    expect(screen.getByText("3 / 4818")).toHaveAttribute(
      "title",
      "Profile 3 of 4818 reachable, sampled evenly from the 48166 in this record",
    );
  });

  it("calls the All stop a window, not the whole record", () => {
    show(profilesOf(335));
    expect(screen.getByText("0 / 335")).toHaveAttribute(
      "title",
      "Every profile in the most recent rows of this record, drawn at once",
    );
  });
});
