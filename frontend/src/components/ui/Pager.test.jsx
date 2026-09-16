import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import Pager, { PAGE_SIZES } from "./Pager.jsx";

const noop = () => {};

// Pager reads translated copy (useTranslation) for every label, so it needs
// the real i18n instance renderWithProviders sets up — a bare render() would
// see every t() call fall back to the raw key.
const render = (ui) => renderWithProviders(ui);

describe("Pager", () => {
  it("renders nothing when there is nothing to page", () => {
    const { container } = render(
      <Pager
        page={1}
        pageCount={0}
        pageSize={25}
        total={0}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the item range for the current page", () => {
    render(
      <Pager
        page={2}
        pageCount={4}
        pageSize={25}
        total={90}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    // firstItem = (2-1)*25 = 25 -> items 26-50 of 90.
    expect(screen.getByText("26–50 of 90")).toBeInTheDocument();
  });

  it("hides the page controls entirely when there's only one page", () => {
    render(
      <Pager
        page={1}
        pageCount={1}
        pageSize={25}
        total={10}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", () => {
    render(
      <Pager
        page={1}
        pageCount={3}
        pageSize={25}
        total={75}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.getByTitle("Previous page")).toBeDisabled();
    expect(screen.getByTitle("Next page")).not.toBeDisabled();
  });

  it("clicking a page number calls onPageChange with that page", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pager
        page={1}
        pageCount={3}
        pageSize={25}
        total={75}
        onPageChange={onPageChange}
        onPageSizeChange={noop}
      />,
    );
    await user.click(screen.getByText("3"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("Next/Previous step relative to the current page", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pager
        page={2}
        pageCount={3}
        pageSize={25}
        total={75}
        onPageChange={onPageChange}
        onPageSizeChange={noop}
      />,
    );
    await user.click(screen.getByTitle("Next page"));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByTitle("Previous page"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("collapses distant pages behind an ellipsis, keeping first/last and the current page's neighbours", () => {
    render(
      <Pager
        page={12}
        pageCount={24}
        pageSize={25}
        total={600}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    ["1", "11", "12", "13", "24"].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument(),
    );
    // 2 gaps: between 1 and 11, and between 13 and 24.
    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("shows a skipped single page as a number, not an ellipsis", () => {
    // current=2 of 4: window covers 1,2,3; only page 4 is left out, and it's
    // adjacent (gap of 1) so it should render as "4", no ellipsis needed at all.
    render(
      <Pager
        page={2}
        pageCount={4}
        pageSize={25}
        total={100}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    ["1", "2", "3", "4"].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument(),
    );
  });

  it("marks the current page with aria-current", () => {
    render(
      <Pager
        page={2}
        pageCount={3}
        pageSize={25}
        total={75}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("1")).not.toHaveAttribute("aria-current");
  });

  it("offers the default PAGE_SIZES and reports a change", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pager
        page={1}
        pageCount={3}
        pageSize={25}
        total={75}
        onPageChange={noop}
        onPageSizeChange={onPageSizeChange}
        perPageLabel="Per page"
      />,
    );
    const select = screen.getByTitle("Per page");
    PAGE_SIZES.forEach((size) =>
      expect(
        screen.getByRole("option", { name: `${size} per page` }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(select, String(PAGE_SIZES[1]));
    expect(onPageSizeChange).toHaveBeenCalledWith(PAGE_SIZES[1]);
  });
});
