import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";

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

  it("commits a day picked from the calendar, and offers none out of range", async () => {
    const onCommit = vi.fn();
    const { user } = renderWithProviders(
      <DateField
        value="2015-06-10"
        min="2015-06-05"
        max="2015-06-20"
        label="Start"
        onCommit={onCommit}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: /Open calendar/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: /June 4/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.click(within(dialog).getByRole("button", { name: /June 15/ }));
    expect(onCommit).toHaveBeenLastCalledWith("2015-06-15");
  });

  async function openPicker(user, name) {
    await user.click(
      await screen.findByRole("button", { name: /Open calendar/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name }));
    return { dialog, list: await screen.findByRole("listbox") };
  }

  it("sets the date from a picked month and year, keeping the day", async () => {
    const onCommit = vi.fn();
    const { user } = renderWithProviders(
      <DateField
        value="2015-06-10"
        min="1990-01-01"
        max="2020-12-31"
        label="Start"
        onCommit={onCommit}
      />,
    );
    const { dialog, list } = await openPicker(user, /month/i);
    await user.click(within(list).getByRole("option", { name: "Feb" }));
    expect(onCommit).toHaveBeenLastCalledWith("2015-02-10");
    await user.click(within(dialog).getByRole("button", { name: /year/i }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "1995",
      }),
    );
    expect(onCommit).toHaveBeenLastCalledWith("1995-02-10");
    await user.click(
      within(dialog).getByRole("button", { name: /February 14, 1995/ }),
    );
    expect(onCommit).toHaveBeenLastCalledWith("1995-02-14");
  });

  it("starts the year list at yearMin", async () => {
    const { user } = renderWithProviders(
      <DateField
        value="2015-01-01"
        min="1900-01-01"
        max="2020-12-31"
        yearMin="2010-05-01"
        label="Start"
        onCommit={() => {}}
      />,
    );
    const { list } = await openPicker(user, /year/i);
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(Array.from({ length: 11 }, (_, i) => `${2010 + i}`));
  });

  it("clamps a picked year to the minimum date", async () => {
    const onCommit = vi.fn();
    const { user } = renderWithProviders(
      <DateField
        value="2016-03-01"
        min="2015-06-05"
        max="2020-12-31"
        label="Start"
        onCommit={onCommit}
      />,
    );
    const { list } = await openPicker(user, /year/i);
    await user.click(within(list).getByRole("option", { name: "2015" }));
    expect(onCommit).toHaveBeenLastCalledWith("2015-06-05");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
