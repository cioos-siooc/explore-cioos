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

  it("lists servers alphabetically under ERDDAP, then the featured nodes under OBIS", () => {
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
    expect(names).toEqual([
      "ERDDAP",
      "Alpha ERDDAP",
      "Zeta ERDDAP",
      "OBIS",
      "OBIS Canada",
    ]);
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

  it("the OBIS chevron collapses its nodes without toggling the group", async () => {
    const setObisNodesSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={[]}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={setObisNodesSelected}
      />,
    );
    expect(screen.getByText("OBIS Canada")).toBeInTheDocument();
    await user.click(document.querySelector(".sourceGroupChevron"));
    expect(screen.queryByText("OBIS Canada")).not.toBeInTheDocument();
    expect(setObisNodesSelected).not.toHaveBeenCalled();
  });

  it("lists only the featured and already-set nodes until asked for more", async () => {
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={[]}
        setErddapServersSelected={() => {}}
        obisNodesSelected={[
          ...NODES,
          { pk: 12, title: "EurOBIS", isExcluded: true },
          { pk: 13, title: "OTN-OBIS" },
        ]}
        setObisNodesSelected={() => {}}
      />,
    );
    expect(screen.getByText("OTN-OBIS")).toBeInTheDocument();
    expect(screen.getByText("EurOBIS")).toBeInTheDocument();
    expect(screen.queryByText("OBIS US")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getByText("OBIS US")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("OBIS US")).not.toBeInTheDocument();
  });

  it("a search lists every matching node, featured or not", () => {
    renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={() => {}}
        obisNodesSelected={NODES}
        setObisNodesSelected={() => {}}
        searchTerms="us"
      />,
    );
    expect(screen.getByText("OBIS US")).toBeInTheDocument();
    expect(screen.queryByText("OBIS Canada")).not.toBeInTheDocument();
    expect(screen.queryByText("ERDDAP")).not.toBeInTheDocument();
  });

  it("clicking the ERDDAP group button selects every server", async () => {
    const setErddapServersSelected = vi.fn();
    const { user } = renderWithProviders(
      <SourceFilter
        erddapServersSelected={SERVERS}
        setErddapServersSelected={setErddapServersSelected}
        obisNodesSelected={[]}
        setObisNodesSelected={() => {}}
      />,
    );
    await user.click(
      document.querySelector(".sourceGroupButton .optionToggle"),
    );
    expect(setErddapServersSelected).toHaveBeenCalledWith([
      { pk: 1, title: "Zeta ERDDAP", isSelected: true, isExcluded: false },
      { pk: 2, title: "Alpha ERDDAP", isSelected: true, isExcluded: false },
    ]);
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
    await user.click(
      document.querySelector(".sourceGroupButton .optionToggle"),
    );
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
    const group = () => document.querySelector(".sourceGroupButton");
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
