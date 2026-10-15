// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindBar } from "./FindBar";

afterEach(cleanup);

const setup = (found = true) => {
  const onFind = vi.fn(() => found);
  const onClose = vi.fn();
  render(<FindBar onFind={onFind} onClose={onClose} />);
  const input = screen.getByLabelText("Find in terminal");
  fireEvent.change(input, { target: { value: "error" } });
  return { onFind, onClose, input };
};

describe("FindBar", () => {
  it("focuses the search field when it opens", () => {
    setup();
    expect(document.activeElement).toBe(screen.getByLabelText("Find in terminal"));
  });

  it("finds the next match on Enter and the previous one on Shift+Enter or the buttons", () => {
    const { onFind, input } = setup();
    const plain = { caseSensitive: false, regex: false };
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFind).toHaveBeenLastCalledWith("error", plain, "next");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onFind).toHaveBeenLastCalledWith("error", plain, "previous");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(onFind).toHaveBeenLastCalledWith("error", plain, "next");
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(onFind).toHaveBeenLastCalledWith("error", plain, "previous");
  });

  it("passes match case and regex", () => {
    const { onFind, input } = setup();
    fireEvent.click(screen.getByLabelText("Match case"));
    fireEvent.click(screen.getByLabelText("Regex"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFind).toHaveBeenLastCalledWith("error", { caseSensitive: true, regex: true }, "next");
  });

  it("says when nothing matches", () => {
    const { input } = setup(false);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("does not search for an empty text", () => {
    const { onFind, input } = setup();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFind).not.toHaveBeenCalled();
  });

  it("closes on Escape and with the close button", () => {
    const { onClose, input } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
