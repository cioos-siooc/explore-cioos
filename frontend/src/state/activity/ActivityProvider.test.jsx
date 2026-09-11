import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

import ActivityProvider, {
  useActivity,
  useActivityTask,
  useActivityTasks,
} from "./ActivityProvider.jsx";

function Probe() {
  const { labelKeys, busy, announced } = useActivity();
  return (
    <span data-testid="state">
      {JSON.stringify({ labelKeys: [...labelKeys].sort(), busy, announced })}
    </span>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent);

function TaskFlag({ label, active }) {
  useActivityTask(label, active);
  return null;
}

function TaskList({ labels }) {
  useActivityTasks(labels);
  return null;
}

describe("ActivityProvider outside a provider (index.jsx's Suspense fallback)", () => {
  it("defaults to an empty, non-busy registry rather than crashing", () => {
    render(<Probe />);
    expect(state()).toEqual({ labelKeys: [], busy: false, announced: false });
  });
});

describe("useActivityTask / useActivityTasks", () => {
  it("registers a key while active, and unregisters it once inactive", () => {
    function Harness({ active }) {
      return (
        <ActivityProvider>
          <TaskFlag label="legendLoadingText" active={active} />
          <Probe />
        </ActivityProvider>
      );
    }
    const { rerender } = render(<Harness active />);
    expect(state().labelKeys).toEqual(["legendLoadingText"]);

    rerender(<Harness active={false} />);
    expect(state().labelKeys).toEqual([]);
  });

  it("collapses two callers registering the same key into one, and only clears once both finish", () => {
    function Harness({ first, second }) {
      return (
        <ActivityProvider>
          <TaskFlag label="activityDatasetsText" active={first} />
          <TaskFlag label="activityDatasetsText" active={second} />
          <Probe />
        </ActivityProvider>
      );
    }
    const { rerender } = render(<Harness first second />);
    expect(state().labelKeys).toEqual(["activityDatasetsText"]);

    rerender(<Harness first second={false} />);
    // Second caller dropped out, but the first is still active — key survives.
    expect(state().labelKeys).toEqual(["activityDatasetsText"]);

    rerender(<Harness first={false} second={false} />);
    expect(state().labelKeys).toEqual([]);
  });

  it("registers every key in a dynamic list via useActivityTasks", () => {
    function Harness({ labels }) {
      return (
        <ActivityProvider>
          <TaskList labels={labels} />
          <Probe />
        </ActivityProvider>
      );
    }
    render(
      <Harness labels={["activityLayerTracks", "activityLayerBathymetry"]} />,
    );
    expect(state().labelKeys.sort()).toEqual(
      ["activityLayerBathymetry", "activityLayerTracks"].sort(),
    );
  });
});

describe("busy / announced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is busy the instant something registers, but announced only after the delay", () => {
    function Harness({ active }) {
      return (
        <ActivityProvider>
          <TaskFlag label="legendLoadingText" active={active} />
          <Probe />
        </ActivityProvider>
      );
    }
    render(<Harness active />);
    expect(state().busy).toBe(true);
    expect(state().announced).toBe(false);

    act(() => vi.advanceTimersByTime(250));
    expect(state().announced).toBe(true);
  });

  it("retracts announced immediately on going quiet, not after the delay", () => {
    function Harness({ active }) {
      return (
        <ActivityProvider>
          <TaskFlag label="legendLoadingText" active={active} />
          <Probe />
        </ActivityProvider>
      );
    }
    const { rerender } = render(<Harness active />);
    act(() => vi.advanceTimersByTime(250));
    expect(state().announced).toBe(true);

    rerender(<Harness active={false} />);
    expect(state().busy).toBe(false);
    expect(state().announced).toBe(false);
  });

  it("never announces work that resolves before the delay elapses", () => {
    function Harness({ active }) {
      return (
        <ActivityProvider>
          <TaskFlag label="legendLoadingText" active={active} />
          <Probe />
        </ActivityProvider>
      );
    }
    const { rerender } = render(<Harness active />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<Harness active={false} />);
    act(() => vi.advanceTimersByTime(250));
    expect(state().announced).toBe(false);
  });
});
