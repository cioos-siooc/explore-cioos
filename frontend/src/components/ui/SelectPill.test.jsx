import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SelectPill from "./SelectPill.jsx";

const OPTIONS = [
  { id: "none", label: "None" },
  { id: "type", label: "Type" },
];

describe("SelectPill", () => {
  it("associates the label with the select via a shared id", () => {
    render(<SelectPill label="Group" value="none" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByLabelText("Group")).toBeInTheDocument();
  });

  it("renders every option", () => {
    render(<SelectPill label="Group" value="none" options={OPTIONS} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Type" })).toBeInTheDocument();
  });

  it("calls onChange with the newly selected option's id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectPill label="Group" value="none" options={OPTIONS} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Group"), "type");
    expect(onChange).toHaveBeenCalledWith("type");
  });

  it("renders the selected option's label in the width-sizing span", () => {
    render(<SelectPill label="Group" value="type" options={OPTIONS} onChange={() => {}} />);
    const sizer = document.querySelector(".selectPillSizer");
    expect(sizer).toHaveTextContent("Type");
  });

  it("renders trailing children inside the same pill", () => {
    render(
      <SelectPill label="Sort" value="none" options={OPTIONS} onChange={() => {}}>
        <button>asc</button>
      </SelectPill>,
    );
    expect(screen.getByRole("button", { name: "asc" })).toBeInTheDocument();
  });
});
