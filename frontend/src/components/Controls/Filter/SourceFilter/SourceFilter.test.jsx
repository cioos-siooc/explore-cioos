import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import SourceFilter from "./SourceFilter.jsx";

const SERVERS = [
  { pk: 0, url: "https://erddap.ogsl.ca/erddap", title: "OGSL ERDDAP" },
  { pk: 1, url: "https://other.example/erddap", title: "Zeta ERDDAP" },
];
const OWNERS = [
  { pk: "SLGO", title: "SLGO", erddapServers: [SERVERS[0].url] },
  { pk: "CIOOS Pacific", title: "CIOOS Pacific", erddapServers: [] },
  // Neither a server nor OBIS records: nothing to pick, so not listed.
  { pk: "DataStream", title: "DataStream", erddapServers: [] },
];
const OBIS_CATALOGUES = [
  { pk: "SLGO", title: "SLGO" },
  { pk: "CIOOS Pacific", title: "CIOOS Pacific" },
];
const NODES = [
  { pk: "OBIS Canada", title: "OBIS Canada" },
  { pk: "OBIS US", title: "OBIS US" },
];

// Real state, so a click shows up as the next render's ticks.
function Harness({ initial = {}, searchTerms, onState }) {
  const [servers, setServers] = React.useState(initial.servers ?? SERVERS);
  const [nodes, setNodes] = React.useState(initial.nodes ?? NODES);
  const [obisCatalogues, setObisCatalogues] = React.useState(
    initial.obisCatalogues ?? OBIS_CATALOGUES,
  );
  onState?.({ servers, nodes, obisCatalogues });
  return (
    <SourceFilter
      erddapServersSelected={servers}
      setErddapServersSelected={setServers}
      obisNodesSelected={nodes}
      setObisNodesSelected={setNodes}
      portalOwners={initial.owners ?? OWNERS}
      obisCataloguesSelected={obisCatalogues}
      setObisCataloguesSelected={setObisCatalogues}
      searchTerms={searchTerms}
    />
  );
}

const names = () =>
  [...document.querySelectorAll(".optionName")].map((el) => el.textContent);
const portalRow = (label) =>
  screen
    .getAllByText(label, { selector: ".sourceGroupButton .optionName" })[0]
    .closest(".sourceGroupRow");
const stateOf = (label) =>
  ["selected", "excluded"].filter((c) =>
    portalRow(label).querySelector(".sourceGroupButton").classList.contains(c),
  );
const ticked = (list) =>
  list.filter((o) => o.isSelected).map((o) => o.pk ?? o.url);

describe("SourceFilter", () => {
  it("shows the no-filter-options message when there is nothing to show", () => {
    renderWithProviders(
      <Harness
        initial={{ servers: [], nodes: [], owners: [], obisCatalogues: [] }}
      />,
    );
    expect(screen.getByText("No filter options")).toBeInTheDocument();
  });

  it("lists the portals alphabetically, each over the ERDDAP and OBIS it has, an unclaimed server as its own portal", () => {
    renderWithProviders(<Harness />);
    expect(names()).toEqual([
      "CIOOS Pacific",
      "OBIS",
      "OBIS",
      "OBIS Canada",
      "SLGO",
      "ERDDAP",
      "OBIS",
      "Zeta ERDDAP",
      "ERDDAP",
    ]);
  });

  it("a portal's box ticks every leaf it has, across the lists", async () => {
    let state;
    const { user } = renderWithProviders(
      <Harness onState={(s) => (state = s)} />,
    );
    await user.click(
      portalRow("SLGO").querySelector(".sourceGroupButton .optionToggle"),
    );
    expect(ticked(state.servers)).toEqual([0]);
    expect(ticked(state.obisCatalogues)).toEqual(["SLGO"]);
    expect(ticked(state.nodes)).toEqual([]);
    expect(stateOf("SLGO")).toEqual(["selected"]);
  });

  it("a leaf toggles only itself, and leaves its portal mixed", async () => {
    let state;
    const { user } = renderWithProviders(
      <Harness onState={(s) => (state = s)} />,
    );
    const leaves = portalRow("SLGO").nextElementSibling;
    await user.click(within(leaves).getByText("OBIS"));
    expect(ticked(state.obisCatalogues)).toEqual(["SLGO"]);
    expect(ticked(state.servers)).toEqual([]);
    expect(stateOf("SLGO")).toEqual([]);
    await user.click(
      within(leaves).getByRole("button", { name: "Exclude: ERDDAP" }),
    );
    expect(state.servers.find((s) => s.pk === 0).isExcluded).toBe(true);
  });

  it("a portal's chevron collapses its leaves without toggling it", async () => {
    let state;
    const { user } = renderWithProviders(
      <Harness onState={(s) => (state = s)} />,
    );
    await user.click(
      within(portalRow("SLGO")).getByRole("button", { expanded: true }),
    );
    expect(names()).not.toContain("ERDDAP: OGSL ERDDAP");
    expect(names().filter((n) => n === "ERDDAP")).toEqual(["ERDDAP"]);
    expect(ticked(state.servers)).toEqual([]);
  });

  it("the OBIS portal includes or excludes every node at once", async () => {
    const { user } = renderWithProviders(
      <Harness
        initial={{ nodes: [{ ...NODES[0], isSelected: true }, NODES[1]] }}
      />,
    );
    const exclude = () =>
      within(portalRow("OBIS")).getByRole("button", { name: "Exclude: OBIS" });
    // A mixed portal goes to all-included first.
    expect(stateOf("OBIS")).toEqual([]);
    await user.click(
      portalRow("OBIS").querySelector(".sourceGroupButton .optionToggle"),
    );
    expect(stateOf("OBIS")).toEqual(["selected"]);
    await user.click(exclude());
    expect(stateOf("OBIS")).toEqual(["excluded"]);
    await user.click(exclude());
    expect(stateOf("OBIS")).toEqual([]);
  });

  it("lists only the featured and already-set nodes until asked for more", async () => {
    const { user } = renderWithProviders(
      <Harness
        initial={{
          nodes: [
            ...NODES,
            { pk: "EurOBIS", title: "EurOBIS", isExcluded: true },
            { pk: "OTN-OBIS", title: "OTN-OBIS" },
          ],
        }}
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

  it("a search on a portal's name shows it expanded with all its leaves", () => {
    renderWithProviders(<Harness searchTerms="slgo" />);
    expect(names()).toEqual(["SLGO", "ERDDAP", "OBIS"]);
  });

  it("a search on a leaf kind lists it under every portal that has one", () => {
    renderWithProviders(<Harness searchTerms="erddap" />);
    expect(names()).toEqual(["SLGO", "ERDDAP", "Zeta ERDDAP", "ERDDAP"]);
  });

  it("a search lists every matching node, featured or not", () => {
    renderWithProviders(<Harness searchTerms="us" />);
    expect(screen.getByText("OBIS US")).toBeInTheDocument();
    expect(screen.queryByText("OBIS Canada")).not.toBeInTheDocument();
  });
});
