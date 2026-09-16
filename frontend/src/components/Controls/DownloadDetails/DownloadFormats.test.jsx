import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import DownloadFormats from "./DownloadFormats.jsx";
import {
  defaultErddapFormat,
  defaultObisFormat,
} from "../../../downloadLinks.js";

const link = (source) => ({ source, pk: source === "obis" ? 2 : 1 });

const open = (overrides = {}) => {
  const setErddapFormat = vi.fn();
  const setObisFormat = vi.fn();
  return {
    setErddapFormat,
    setObisFormat,
    ...renderWithProviders(
      <DownloadFormats
        links={[link("erddap"), link("obis")]}
        erddapFormat={defaultErddapFormat}
        setErddapFormat={setErddapFormat}
        obisFormat={defaultObisFormat}
        setObisFormat={setObisFormat}
        {...overrides}
      />,
    ),
  };
};

// SelectPill's test id sits on the pill; the control inside it is the select.
const picker = (id) => within(screen.getByTestId(id)).getByRole("combobox");

describe("DownloadFormats", () => {
  it("offers a picker per catalogue the selection actually holds", () => {
    open({ links: [link("erddap")] });
    expect(screen.getByTestId("direct-links-erddap-format")).toBeTruthy();
    expect(screen.queryByTestId("direct-links-obis-format")).toBeNull();
  });

  it("reports the chosen format to the panel that builds the links", async () => {
    const { user, setErddapFormat } = open();
    await user.selectOptions(picker("direct-links-erddap-format"), "parquet");
    expect(setErddapFormat).toHaveBeenCalledWith("parquet");
  });

  it("is absent while nothing in the selection can be linked to", () => {
    const { container } = open({ links: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
