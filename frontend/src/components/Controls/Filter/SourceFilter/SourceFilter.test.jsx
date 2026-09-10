import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import SourceFilter from "./SourceFilter.jsx";

const SERVERS = [
  { pk: 1, title: "Zeta ERDDAP", isSelected: false },
  { pk: 2, title: "Alpha ERDDAP", isSelected: true },
];
const NODES = [
  { pk: 10, title: "OBIS Canada", isSelected: false },
  { pk: 11, title: "OBIS US", isSelected: false },
];

describe("SourceFilter", () => {
  it("shows the no-filter-options message when there is nothing to show", () => {
    renderWithProviders(
      <SourceFilter
        erddapServersSelected={[]}
        setErddapServersSelected={() => {}}
        obisNodesSelected={[]}
        setObisNodesSelected={() => {}}
      />,
    );
    expect(screen.getByText("No filter options")).toBeInTheDocument();
  });

  it("sorts servers alphabetically and shows the OBIS group when nodes exist", () => {
    renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={() => {}}
      />,
    );
    const names = [...document.querySelectorAll(".optionName")].map(
      (el) => el.textContent,
    );
    expect(names[0]).toBe("Alpha ERDDAP");
    expect(names[1]).toBe("Zeta ERDDAP");
    expect(names).toContain("OBIS");
  });

  it("clicking a server toggles only its own isSelected", async () => {
    const setErddapServersSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={setErddapServersSelected}
        obisNodesSelected={[]}
        setObisNodesSelected={() => {}}
      />,
    );
    await user.click(screen.getByText("Alpha ERDDAP"));
    expect(setErddapServersSelected).toHaveBeenCalledWith([
      { pk: 1, title: "Zeta ERDDAP", isSelected: false },
      { pk: 2, title: "Alpha ERDDAP", isSelected: false },
    ]);
  });

  it("the OBIS chevron expands to show individual nodes without toggling the group", async () => {
    const setObisNodesSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={[]}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={setObisNodesSelected}
      />,
    );
    expect(screen.queryByText("OBIS Canada")).not.toBeInTheDocument();
    await user.click(document.querySelector(".obisGroupChevron"));
    expect(screen.getByText("OBIS Canada")).toBeInTheDocument();
    expect(setObisNodesSelected).not.toHaveBeenCalled();
  });

  it("clicking the OBIS group button selects every node", async () => {
    const setObisNodesSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={[]}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={setObisNodesSelected}
      />,
    );
    await user.click(document.querySelector(".obisGroupButton"));
    expect(setObisNodesSelected).toHaveBeenCalledWith([
      { pk: 10, title: "OBIS Canada", isSelected: true },
      { pk: 11, title: "OBIS US", isSelected: true },
    ]);
  });

  it("search narrows servers by title and expands OBIS nodes when the group label matches", async () => {
    renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={() => {}}
        searchTerms="obis"
      />,
    );
    expect(screen.queryByText("Alpha ERDDAP")).not.toBeInTheDocument();
    expect(screen.getByText("OBIS Canada")).toBeInTheDocument();
  });
});
