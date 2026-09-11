import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import {
  GridTimeSlice,
  GridDepthSlice,
  gridTimeNodes,
  gridDepthNodes,
} from "./GridSlice.jsx";

const TIME_DIM = {
  name: "time",
  min: "2020-01-01T00:00:00Z",
  max: "2020-01-11T00:00:00Z",
  n_values: 11,
};
const DEPTH_DIM = {
  name: "depth",
  min: 0,
  max: 100,
  n_values: 11,
};
const ALTITUDE_DIM = {
  name: "altitude",
  min: 0,
  max: 100,
  n_values: 11,
};

describe("gridTimeNodes / gridDepthNodes", () => {
  it("returns null without dimensions", () => {
    expect(gridTimeNodes({ dimensions: [] })).toBeNull();
    expect(gridDepthNodes({ dimensions: [] })).toBeNull();
  });

  it("builds evenly-spaced nodes for the time axis", () => {
    const nodes = gridTimeNodes({ dimensions: [TIME_DIM] });
    expect(nodes.count).toBe(11);
    expect(nodes.min).toBe(Date.parse(TIME_DIM.min));
    expect(nodes.max).toBe(Date.parse(TIME_DIM.max));
  });

  it("builds depth-positive-down nodes, negating an altitude axis", () => {
    const depthNodes = gridDepthNodes({ dimensions: [DEPTH_DIM] });
    expect(depthNodes.min).toBe(0);
    expect(depthNodes.max).toBe(100);

    const altitudeNodes = gridDepthNodes({ dimensions: [ALTITUDE_DIM] });
    expect(altitudeNodes.min).toBe(-100);
    expect(altitudeNodes.max).toBe(-0);
  });
});

describe("GridTimeSlice", () => {
  it("renders nothing without a time dimension", () => {
    const { container } = render(
      <GridTimeSlice overlay={{ dimensions: [] }} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the snapped date and the node index/count", () => {
    renderWithProviders(
      <GridTimeSlice
        overlay={{ dimensions: [TIME_DIM], time: "2020-01-05T00:00:00Z" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("5 / 11")).toBeInTheDocument();
  });

  it("stepping forward commits the next node", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GridTimeSlice
        overlay={{ dimensions: [TIME_DIM], time: "2020-01-01T00:00:00Z" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTitle("Next time slice"));
    expect(onChange).toHaveBeenCalledWith("2020-01-02T00:00:00.000Z");
  });

  it("disables the previous step at the first node", () => {
    renderWithProviders(
      <GridTimeSlice
        overlay={{ dimensions: [TIME_DIM], time: "2020-01-01T00:00:00Z" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTitle("Previous time slice")).toBeDisabled();
  });
});

describe("GridDepthSlice", () => {
  it("renders nothing without a vertical dimension", () => {
    const { container } = render(
      <GridDepthSlice overlay={{ dimensions: [] }} onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the depth value and units for a depth-named axis", () => {
    renderWithProviders(
      <GridDepthSlice
        overlay={{ dimensions: [DEPTH_DIM], elevation: -50 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("m")).toBeInTheDocument();
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });

  it("stepping commits the elevation as the negated depth", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GridDepthSlice
        overlay={{ dimensions: [DEPTH_DIM], elevation: 0 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTitle("Next level"));
    expect(onChange).toHaveBeenCalledWith(-10);
  });
});
