// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteConfirm } from "./PasteConfirm";

afterEach(cleanup);

const setup = () => {
  const onPaste = vi.fn();
  const onCancel = vi.fn();
  render(<PasteConfirm lineCount={7} preview={["a", "b", "c", "d", "e"]} onPaste={onPaste} onCancel={onCancel} />);
  return { onPaste, onCancel };
};

describe("PasteConfirm", () => {
  it("shows the line count and the first lines", () => {
    setup();
    expect(screen.getByText("Paste 7 lines?")).toBeTruthy();
    expect(screen.getByTestId("paste-preview").textContent).toBe("a\nb\nc\nd\ne\n…");
  });

  it("pastes, reporting whether to ask again", () => {
    const { onPaste } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(onPaste).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText("Don't ask again"));
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(onPaste).toHaveBeenLastCalledWith(true);
  });

  it("cancels with the button or Escape", () => {
    const { onCancel, onPaste } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Paste" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPaste).not.toHaveBeenCalled();
  });
});
