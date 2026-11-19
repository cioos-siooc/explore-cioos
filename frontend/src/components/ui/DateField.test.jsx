import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { typeDate } from "../../test/typeDate.js";
import DateField, { isCommittable } from "./DateField.jsx";

describe("isCommittable", () => {
  it("requires a full four-digit-year date, not a partial one being typed", () => {
    expect(isCommittable("2015", "1900-01-01", "2025-01-01")).toBe(false);
    expect(isCommittable("2015-0", "1900-01-01", "2025-01-01")).toBe(false);
    expect(isCommittable("2015-06-15", "1900-01-01", "2025-01-01")).toBe(true);
  });

  it("rejects an unparseable date", () => {
    expect(isCommittable("2015-13-40", undefined, undefined)).toBe(false);
  });

  it("rejects a date outside min/max", () => {
    expect(isCommittable("1899-12-31", "1900-01-01", "2025-01-01")).toBe(false);
    expect(isCommittable("2026-01-01", "1900-01-01", "2025-01-01")).toBe(false);
  });

  it("has no bound when min/max are absent", () => {
    expect(isCommittable("1500-01-01", undefined, undefined)).toBe(true);
  });
});

describe("DateField", () => {
  it("commits as soon as a complete, in-range date is typed", async () => {
    const onCommit = vi.fn();
    const { user } = renderWithProviders(
      <DateField
        value="2015-01-01"
        min="1900-01-01"
        max="2025-01-01"
        label="Start"
        onCommit={onCommit}
      />,
    );
    await typeDate(user, await screen.findByLabelText("Start"), "2015-06-15");
    expect(onCommit).toHaveBeenLastCalledWith("2015-06-15");
  });

  it("does not commit an out-of-range date, and restores the committed one on blur", async () => {
    const onCommit = vi.fn();
    const { user } = renderWithProviders(
      <DateField
        value="2015-01-01"
        min="1900-01-01"
        max="2025-01-01"
        label="Start"
        onCommit={onCommit}
      />,
    );
    const field = await screen.findByLabelText("Start");
    await typeDate(user, field, "2030-01-01");
    expect(onCommit).not.toHaveBeenCalledWith("2030-01-01");
    await user.tab();
    await user.tab();
    await user.tab();
    await waitFor(() => expect(field).toHaveTextContent("2015-01-01"));
  });

  it("follows an externally-changed committed value while idle", async () => {
    const { rerender } = renderWithProviders(
      <DateField value="2015-01-01" label="Start" onCommit={() => {}} />,
    );
    rerender(
      <DateField value="2016-02-02" label="Start" onCommit={() => {}} />,
    );
    expect(await screen.findByLabelText("Start")).toHaveTextContent(
      "2016-02-02",
    );
  });

  it("orders its segments year, month, day in French too", async () => {
    const { i18n } = renderWithProviders(
      <DateField value="2015-06-15" label="Début" onCommit={() => {}} />,
    );
    await screen.findByLabelText("Début");
    await act(() => i18n.changeLanguage("fr"));
    expect(screen.getByLabelText("Début")).toHaveTextContent("2015-06-15");
    await act(() => i18n.changeLanguage("en"));
  });
});
