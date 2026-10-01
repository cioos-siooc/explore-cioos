import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import usePreviewProfiles from "./usePreviewProfiles.js";

// Two rules worth holding: a record switched while the fetch is in flight must
// not be described by the previous one's casts, and a failure is not an error
// state — no steps means no slider, and the plot is what it was.

const STEPS = { column: "profile", steps: ["a", "b", "c"], count: 3 };

function Probe({ datasetId, recordId }) {
  const profiles = usePreviewProfiles(datasetId, recordId);
  return <span data-testid="steps">{profiles.steps.join(",")}</span>;
}

const steps = () => screen.getByTestId("steps").textContent;

const jsonOnce = (body, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe("usePreviewProfiles", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => jsonOnce(STEPS));
  });

  it("lists the record's casts once they arrive", async () => {
    renderWithProviders(<Probe datasetId="d1" recordId="r1" />);
    await waitFor(() => expect(steps()).toBe("a,b,c"));

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/preview/profiles");
    expect(url).toContain("dataset=d1");
    expect(url).toContain("profile=r1");
  });

  it("degrades to no slider when the list cannot be fetched", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("offline")));
    renderWithProviders(<Probe datasetId="d1" recordId="r1" />);
    // Silent: no throw, no error state, just nothing to step through.
    await waitFor(() => expect(steps()).toBe(""));
  });

  it("degrades to no slider when the route refuses", async () => {
    global.fetch = vi.fn(() => jsonOnce(null, false));
    renderWithProviders(<Probe datasetId="d1" recordId="r1" />);
    await waitFor(() => expect(steps()).toBe(""));
  });

  it("asks for nothing until it has both halves of the key", () => {
    renderWithProviders(<Probe datasetId="d1" recordId={undefined} />);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(steps()).toBe("");
  });

  it("never describes a record with the previous record's casts", async () => {
    const { rerender } = renderWithProviders(
      <Probe datasetId="d1" recordId="r1" />,
    );
    await waitFor(() => expect(steps()).toBe("a,b,c"));

    // The next record's list has not landed yet: the answer is derived from the
    // key it was stored under, so it reads empty rather than stale.
    let resolve;
    global.fetch = vi.fn(
      () =>
        new Promise((done) => {
          resolve = () => done(jsonOnce({ ...STEPS, steps: ["x"] }));
        }),
    );
    rerender(<Probe datasetId="d1" recordId="r2" />);
    expect(steps()).toBe("");

    resolve();
    await waitFor(() => expect(steps()).toBe("x"));
  });
});
