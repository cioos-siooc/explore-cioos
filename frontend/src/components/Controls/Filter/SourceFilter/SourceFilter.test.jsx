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

  it("clicking a server toggles only its own inclusion, and its button only its exclusion", async () => {
    const setErddapServersSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={setErddapServersSelected}
        obisNodesSelected={[]}
        setObisNodesSelected={() => {}}
      />,
    );
    // Alpha starts included, so clicking it unticks it.
    await user.click(screen.getByText("Alpha ERDDAP"));
    expect(setErddapServersSelected).toHaveBeenLastCalledWith([
      { pk: 1, title: "Zeta ERDDAP", isSelected: false },
      { pk: 2, title: "Alpha ERDDAP", isSelected: false, isExcluded: false },
    ]);
    await user.click(
      screen.getByRole("button", { name: "Exclude: Alpha ERDDAP" }),
    );
    expect(setErddapServersSelected).toHaveBeenLastCalledWith([
      { pk: 1, title: "Zeta ERDDAP", isSelected: false },
      { pk: 2, title: "Alpha ERDDAP", isSelected: false, isExcluded: true },
    ]);
    await user.click(screen.getByText("Zeta ERDDAP"));
    expect(setErddapServersSelected).toHaveBeenLastCalledWith([
      { pk: 1, title: "Zeta ERDDAP", isSelected: true, isExcluded: false },
      { pk: 2, title: "Alpha ERDDAP", isSelected: true },
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
    await user.click(document.querySelector(".obisGroupButton .optionToggle"));
    expect(setObisNodesSelected).toHaveBeenCalledWith([
      { pk: 10, title: "OBIS Canada", isSelected: true, isExcluded: false },
      { pk: 11, title: "OBIS US", isSelected: true, isExcluded: false },
    ]);
  });

  it("the OBIS group includes or excludes every node at once", async () => {
    function Harness() {
      const [nodes, setNodes] = React.useState([
        { pk: 10, title: "OBIS Canada", isSelected: true },
        { pk: 11, title: "OBIS US", isSelected: false },
      ]);
      return (
        <SourceFilter
          erddapServersSelected={[]}
          setErddapServersSelected={() => {}}
          obisNodesSelected={nodes}
          setObisNodesSelected={setNodes}
        />
      );
    }
    const { user } = renderWithProviders(<Harness />);
    const group = () => document.querySelector(".obisGroupButton");
    const state = () =>
      ["selected", "excluded"].filter((c) => group().classList.contains(c));

    const exclude = () => screen.getByRole("button", { name: "Exclude: OBIS" });

    // A mixed group goes to all-included first.
    expect(state()).toEqual([]);
    await user.click(group().querySelector(".optionToggle"));
    expect(state()).toEqual(["selected"]);
    await user.click(exclude());
    expect(state()).toEqual(["excluded"]);
    await user.click(exclude());
    expect(state()).toEqual([]);
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
