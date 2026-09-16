import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useDebouncedSearchInput } from "./utilities.jsx";

// A search box wired exactly as the real ones are: the text comes from the
// caller's state, the setter is what the box publishes into.
function SearchBox({ value, onChange, delay }) {
  const [text, setText] = useDebouncedSearchInput(value, onChange, delay);
  return (
    <input
      aria-label="search"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  );
}

// One change event per character, as the input sees them. Typed through
// fireEvent rather than userEvent because userEvent runs its own clock, and the
// clock here is the thing under test.
function type(text) {
  const input = screen.getByLabelText("search");
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: input.value + text[i - 1] } });
  }
}

describe("useDebouncedSearchInput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows every keystroke at once, and publishes none of them while typing", () => {
    const onChange = vi.fn();
    render(<SearchBox value="" onChange={onChange} delay={300} />);

    type("temp");

    expect(screen.getByLabelText("search")).toHaveValue("temp");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("publishes once, with the whole word, after typing pauses", () => {
    const onChange = vi.fn();
    render(<SearchBox value="" onChange={onChange} delay={300} />);

    type("temp");
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("temp");
  });

  it("publishes a pause mid-word, and keeps taking keystrokes after it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchBox value="" onChange={onChange} delay={300} />,
    );
    type("te");
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenLastCalledWith("te");

    // The caller's state now follows what was published. The box must not be
    // reset to it — the user is still typing into it.
    rerender(<SearchBox value="te" onChange={onChange} delay={300} />);
    type("mp");
    expect(screen.getByLabelText("search")).toHaveValue("temp");

    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("temp");
  });

  it("publishes an emptied box at once — undoing a search shouldn't wait", () => {
    const onChange = vi.fn();
    render(<SearchBox value="temp" onChange={onChange} delay={300} />);

    fireEvent.change(screen.getByLabelText("search"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("takes an outside change — Reset, a chip removed — into the box, dropping what was pending", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchBox value="temp" onChange={onChange} delay={300} />,
    );

    type("era");
    rerender(<SearchBox value="" onChange={onChange} delay={300} />);
    expect(screen.getByLabelText("search")).toHaveValue("");

    act(() => vi.advanceTimersByTime(300));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("publishes what is still pending when the box goes away", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <SearchBox value="" onChange={onChange} delay={300} />,
    );

    type("temp");
    unmount();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("temp");
    // …and the dropped timer doesn't publish it a second time.
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
