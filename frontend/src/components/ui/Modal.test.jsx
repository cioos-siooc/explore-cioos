import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "./Modal.jsx";

describe("Modal", () => {
  it("renders nothing when show is false", () => {
    render(
      <Modal show={false}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders its content into a portal when show is true", () => {
    render(
      <Modal show>
        <Modal.Body>hello</Modal.Body>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("calls onHide on Escape", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("calls onHide on a backdrop click, but not on a click inside the dialog", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    await user.click(screen.getByText("content"));
    expect(onHide).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("Modal.Header's close button calls onHide", async () => {
    const user = userEvent.setup();
    const onHide = vi.fn();
    render(
      <Modal show onHide={onHide}>
        <Modal.Header closeButton>
          <Modal.Title>Title</Modal.Title>
        </Modal.Header>
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", async () => {
    function Harness() {
      const [show, setShow] = React.useState(false);
      return (
        <>
          <button onClick={() => setShow(true)}>open</button>
          <Modal show={show} onHide={() => setShow(false)}>
            <Modal.Body>content</Modal.Body>
          </Modal>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("applies a data-testid when given one", () => {
    render(
      <Modal show data-testid="filters-modal">
        <Modal.Body>content</Modal.Body>
      </Modal>,
    );
    expect(screen.getByTestId("filters-modal")).toBeInTheDocument();
  });
});
